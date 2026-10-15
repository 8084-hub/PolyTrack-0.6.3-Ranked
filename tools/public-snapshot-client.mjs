// Public, same-origin backups never replace the authoritative PB submission path.
export function createPublicSnapshotReader({baseUrl,fetchImpl=fetch,now=Date.now,packed=false,onGenerationChange}){
  const pending=new Map(),saved=new Map(),retryAt=new Map();let manifestValue=null;
  let generation=0;
  const generationChanged=Error('Snapshot generation changed');
  const transientFetchErrors=new WeakSet();
  const SHORT_RETRY_MS=30_000,LONG_RETRY_MS=15*60_000;
  function markTransientFetchError(error){
    if(error&&typeof error==='object'&&(error instanceof TypeError||error.name==='AbortError'||error.name==='TimeoutError'))transientFetchErrors.add(error);
    return error;
  }
  function isTransientFailure(error){return Boolean(error&&(transientFetchErrors.has(error)||error.status===429||(error.status>=500&&error.status<=599)));}
  async function fetchSnapshot(url,options){try{return await fetchImpl(url,options);}catch(error){throw markTransientFetchError(error);}}
  async function responseBody(response,method){try{return await response[method]();}catch(error){throw markTransientFetchError(error);}}
  let packageBase=new URL(baseUrl),indexRequest=null,pointerRecoveryRetryAt=0,pointerRecoveryRequest=null,pointerRecoveryFailure=null;
  async function packageIndex(){
    if(!indexRequest){
      const requestedBase=packageBase,requestedGeneration=generation;
      const request=(async()=>{
        const response=await fetchSnapshot(new URL('index.json',requestedBase),{credentials:'omit',cache:'default',signal:AbortSignal.timeout(5000)});
        if(!response.ok){const error=Error('Snapshot index unavailable');error.status=response.status;error.base=requestedBase.href;throw error;}
        const text=await responseBody(response,'text');if(text.length>8*1024*1024)throw Error('Snapshot index too large');
        const index=JSON.parse(text);
        if(index.schemaVersion!==1||index.encoding!=='gzip-xor-a7-v1'||!index.files||typeof index.files!=='object')throw Error('Unsupported snapshot encoding');
        return {index,base:requestedBase,generation:requestedGeneration};
      })();
      let tracked;
      tracked=request.catch(error=>{if(indexRequest===tracked)indexRequest=null;throw error;});
      indexRequest=tracked;
    }
    return indexRequest;
  }
  async function recoverCurrentGeneration(){
    if(pointerRecoveryRequest)return pointerRecoveryRequest;
    if(pointerRecoveryFailure){
      if(now()<pointerRecoveryFailure.retryAt)throw pointerRecoveryFailure.error;
      pointerRecoveryFailure=null;pointerRecoveryRetryAt=0;
    }
    if(now()<pointerRecoveryRetryAt)return false;
    // Bound pointer checks without permanently stranding a tab after another deployment.
    pointerRecoveryRetryAt=now()+LONG_RETRY_MS;
    pointerRecoveryRequest=(async()=>{
      try{
        const parent=new URL('../',packageBase),pointerUrl=new URL('snapshot-current.json',parent);
        if(pointerUrl.origin!==packageBase.origin)return false;
        const response=await fetchSnapshot(pointerUrl,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(5000)});
        if(!response.ok){if(response.status===429||response.status>=500&&response.status<=599){const error=Error('Snapshot pointer unavailable');error.status=response.status;throw error;}return false;}
        if(response.url){const finalUrl=new URL(response.url);if(finalUrl.origin!==pointerUrl.origin||finalUrl.href!==pointerUrl.href)return false;}
        const text=await responseBody(response,'text');if(text.length>16384)return false;
        const pointer=JSON.parse(text);
        if(typeof pointer.currentdir!=='string'||!/^public-snapshots[1-9]\d*$/.test(pointer.currentdir))return false;
        const nextBase=new URL(`${pointer.currentdir}/`,parent);
        if(nextBase.origin!==packageBase.origin||nextBase.pathname!==`${parent.pathname}${pointer.currentdir}/`)return false;
        if(nextBase.href===packageBase.href)return false;
        const previousBaseUrl=packageBase.href;
        packageBase=nextBase;
        generation++;
        indexRequest=null;
        // Retired requests may finish later, but their epoch cannot write these caches.
        pending.clear();saved.clear();retryAt.clear();manifestValue=null;
        // Notify once after invalidation. Do not await callbacks that may read the new package.
        try{Promise.resolve(onGenerationChange?.({previousBaseUrl,baseUrl:packageBase.href,generation})).catch(()=>{});}catch{}
        return true;
      }catch(error){if(isTransientFailure(error)){pointerRecoveryFailure={error,retryAt:now()+SHORT_RETRY_MS};throw error;}return false;}
    })();
    const request=pointerRecoveryRequest;
    request.then(()=>{if(pointerRecoveryRequest===request)pointerRecoveryRequest=null;},()=>{if(pointerRecoveryRequest===request)pointerRecoveryRequest=null;});
    return request;
  }
  async function packedTextAtCurrent(logical,requestedGeneration){
    const pack=await packageIndex();
    if(requestedGeneration!==generation||pack.generation!==requestedGeneration)throw generationChanged;
    const record=pack.index.files[logical];
    if(!record)return null;
    if(!/^[a-f0-9]{64}\.bin$/.test(record.path)||!Number.isSafeInteger(record.decodedBytes)||record.decodedBytes<1||record.decodedBytes>2*1024*1024)throw Error('Invalid snapshot record');
    const response=await fetchSnapshot(new URL(record.path,pack.base),{credentials:'omit',cache:'force-cache',signal:AbortSignal.timeout(5000)});
    if(!response.ok){const error=Error('Snapshot unavailable');error.status=response.status;error.base=pack.base.href;throw error;}
    const bytes=new Uint8Array(await responseBody(response,'arrayBuffer'));if(bytes.length>2*1024*1024)throw Error('Snapshot payload too large');
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if(hash!==record.sha256)throw Error('Snapshot checksum mismatch');
    for(let i=0;i<bytes.length;i++)bytes[i]^=0xa7;
    const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks=[];let total=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>record.decodedBytes||total>2*1024*1024)throw Error('Snapshot decompression limit');chunks.push(value);}}
    finally{await reader.cancel().catch(()=>{});}
    if(total!==record.decodedBytes)throw Error('Snapshot length mismatch');
    const output=new Uint8Array(total);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}
    return new TextDecoder().decode(output);
  }
  async function packedText(logical,requestedGeneration){
    try{return await packedTextAtCurrent(logical,requestedGeneration);}
    catch(error){
      if(requestedGeneration!==generation)throw generationChanged;
      if(error.status===404||error.status===410){
        if(await recoverCurrentGeneration())throw generationChanged;
      }
      throw error;
    }
  }
  async function readAtGeneration(kind,id,accountId,requestedGeneration){
    if(requestedGeneration!==generation)return null;
    const path=kind==='snapshot-meta'?'public-export-summary.json':kind==='track-statistics'?'track-statistics.json':kind==='manifest'?'manifest.json':kind==='racer-directory'?'racer-directory.json':kind==='cosmetic-directory'?'cosmetic-directory.json':kind==='overall'?'overall.json':kind==='overall-results'?'overall-results.json':kind==='event-totals'?'event-totals.json':
      kind==='track'&&/^[a-f0-9]{64}$/.test(id)?`tracks/${id}.json`:
      kind==='event'&&/^[A-Za-z0-9_-]{1,64}$/.test(id)?`events/${id}.json`:
      kind==='archive-month'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(id)?`archives/${id}.json`:
      kind==='profile'&&/^[a-f0-9]{64}$/.test(id)?`profiles/${id}.json`:
      kind==='profile-results'&&/^[a-f0-9]{64}$/.test(id)?`profile-results/${id}.json`:
      kind==='recording'&&/^\d{1,16}$/.test(String(id))&&Number.isSafeInteger(Number(id))&&Number(id)>0?`recordings/${id}.json`:
      kind==='event-replay'&&/^[A-Za-z0-9_-]{1,64}$/.test(id)&&/^[a-f0-9]{64}$/.test(accountId)?`event-replays/${id}/${accountId}.json`:null;
    if(!path)return null;
    if(kind==='manifest'&&manifestValue)return {...manifestValue,_dataSource:'cached'};
    const cached=saved.get(path);
    if(cached&&(packed||now()-cached.checkedAt<600000)){saved.delete(path);saved.set(path,cached);return {...cached.value,_dataSource:'cached'};}
    if(pending.has(path))return pending.get(path);
    if(now()<(retryAt.get(path)||0))return cached?.value||null;
    const request=(async()=>{
      // Fetch capture metadata alongside the board instead of adding another round trip.
      const trackManifest=kind==='track'?readAtGeneration('manifest','','',requestedGeneration):null;
      try{
        let body;
        if(packed){
          body=await packedText(path,requestedGeneration);
          if(requestedGeneration!==generation)return null;
          if(body===null){retryAt.set(path,now()+LONG_RETRY_MS);if(retryAt.size>512)retryAt.delete(retryAt.keys().next().value);return null;}
        }
        else{
          const response=await fetchSnapshot(new URL(path,baseUrl),{credentials:'omit',cache:'default',signal:AbortSignal.timeout(5000)});
          if(!response.ok){const error=Error('Public backup unavailable');error.status=response.status;throw error;}
          if(!String(response.headers.get('content-type')||'').includes('application/json'))throw Error('Public backup unavailable');
          body=await responseBody(response,'text');
        }
        if(body.length>2*1024*1024)throw Error('Public backup exceeds size limit');
        const value=JSON.parse(body);
        if(!value||typeof value!=='object'||Array.isArray(value)||(!['event-replay','snapshot-meta','manifest','track-statistics'].includes(kind)&&!Number.isFinite(value.updatedAt)))throw Error('Invalid public backup');
        if(kind==='snapshot-meta'&&(typeof value.capturedAt!=='string'||!Number.isFinite(Date.parse(value.capturedAt))||Date.parse(value.capturedAt)<=0))throw Error('Invalid snapshot capture date');
        if(kind==='track-statistics'&&(value.schemaVersion!==1||typeof value.complete!=='boolean'||!value.tracks||typeof value.tracks!=='object'||Array.isArray(value.tracks)||Object.entries(value.tracks).some(([id,row])=>!/^[a-f0-9]{64}$/.test(id)||!row||typeof row!=='object'||typeof row.complete!=='boolean'||!(row.count===null||Number.isSafeInteger(row.count)&&row.count>=0)||!(row.players===null||Number.isSafeInteger(row.players)&&row.players>=0)||!(row.totalEntries===null||Number.isSafeInteger(row.totalEntries)&&row.totalEntries>=0)||!(row.weight===null||Number.isFinite(row.weight)&&row.weight>=0)||!(row.revision===null||Number.isSafeInteger(row.revision))||!(row.updatedAt===null||Number.isSafeInteger(row.updatedAt))||!(row.capturedAt===null||typeof row.capturedAt==='string'&&Number.isFinite(Date.parse(row.capturedAt))))))throw Error('Invalid public track statistics');
        if(kind==='manifest'&&(value.schemaVersion!==1||!value.tracks||typeof value.tracks!=='object'||Array.isArray(value.tracks)))throw Error('Invalid public snapshot manifest');
        if(kind==='track'&&value.trackId!==id)throw Error('Public track identity mismatch');
        if(kind==='event'&&value.id!==id)throw Error('Public event identity mismatch');
        if(kind==='profile'&&value.accountId!==id)throw Error('Public profile identity mismatch');
        if(kind==='cosmetic-directory'&&(!value.entries||typeof value.entries!=='object'||Array.isArray(value.entries)||Object.entries(value.entries).some(([id,row])=>!/^[a-f0-9]{64}$/.test(id)||!row?.value||typeof row.value!=='object'||Array.isArray(row.value))))throw Error('Invalid snapshot cosmetics');
        if(kind==='racer-directory'&&(!value.entries||typeof value.entries!=='object'||Array.isArray(value.entries)||Object.entries(value.entries).some(([id,row])=>!/^[a-f0-9]{64}$/.test(id)||!row||typeof row!=='object'||Array.isArray(row)||!Number.isFinite(row.updatedAt)||Object.keys(row).some(key=>!['updatedAt','name','nickname','countryCode','carStyle','carId','carColors','profileCosmetics'].includes(key)))))throw Error('Invalid snapshot racer directory');
        if(kind==='profile-results'&&(value.accountId!==id||!Array.isArray(value.results)||value.results.length>2000||value.results.some(row=>!/^[a-f0-9]{64}$/.test(row?.trackId||''))))throw Error('Public profile results identity mismatch');
        if(kind==='recording'&&(typeof value.recording!=='string'||value.recording.length>850000||!Number.isSafeInteger(value.frames)||value.frames<1))throw Error('Invalid public recording');
        if(kind==='archive-month'&&(!Array.isArray(value.periods)||value.periods.length>500||value.periods.some(p=>typeof p?.id!=='string'||!Number.isSafeInteger(p.startsAt)||new Date(p.startsAt).toISOString().slice(0,7)!==id)))throw Error('Invalid archive month');
        if(kind==='event-replay'&&(value.periodId!==id||value.accountId!==accountId||typeof value.replay!=='string'||value.replay.length>65536))throw Error('Public replay identity mismatch');
        const result={...value,_publicBackup:true,_dataSource:'snapshot'};
        if(kind==='track'){
          const manifest=await trackManifest;
          const checkedAt=manifest?.tracks?.[id]?.checkedAt;
          if(Number.isSafeInteger(checkedAt)&&checkedAt>0)result._snapshotCapturedAt=checkedAt;
        }
        if(requestedGeneration!==generation)return null;
        if(kind==='manifest')manifestValue=result;
        else{
          saved.delete(path);saved.set(path,{value:result,checkedAt:now(),bytes:body.length*2});
          let bytes=0;for(const entry of saved.values())bytes+=entry.bytes;
          while(saved.size>128||bytes>8*1024*1024){const oldest=saved.keys().next().value;bytes-=saved.get(oldest).bytes;saved.delete(oldest);}
        }
        retryAt.delete(path);
        return result;
      }catch(error){
        if(requestedGeneration!==generation)return null;
        retryAt.set(path,now()+(isTransientFailure(error)?SHORT_RETRY_MS:LONG_RETRY_MS));if(retryAt.size>512)retryAt.delete(retryAt.keys().next().value);return cached?.value||null;
      }
    })();
    pending.set(path,request);
    request.finally(()=>{if(pending.get(path)===request)pending.delete(path);}).catch(()=>{});
    return request;
  }
  return async function read(kind,id='',accountId=''){
    for(;;){
      const requestedGeneration=generation;
      const value=await readAtGeneration(kind,id,accountId,requestedGeneration);
      // Rejoin the current generation even when a retired pending request succeeds or fails.
      if(requestedGeneration===generation)return value;
    }
  };
}
