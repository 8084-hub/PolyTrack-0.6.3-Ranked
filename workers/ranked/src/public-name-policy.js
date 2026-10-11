const PROFILE_NAME_WORD_A = ['swift','neon','alpha','turbo','sonic','pixel','nova','lucky','sunny','frost','ember','quantum','crystal','midnight','solar','lunar','hyper','ultra','aero','rapid','vivid','thunder','cosmic','silver','golden','shadow','arc','vector','iron','onyx','starlit','cobalt','ripple','granite','jungle','desert','arctic','magenta','scarlet','violet','teal','sable','amber','jade','ivory','obsidian','cinder','stellar','orbital','zen','rogue','prime','apex','summit','embered','misty','horizon','aurora','glitch','byte','laser','prism','halo','north','south','east','west','tempo','axle','torque','nitro','clutch','summoner','phantom','eclipse','cyclone','monsoon','titan','pegasus','raven','falcon','lynx','otter','comfy','bouncy','cheery','zippy','daring','brisk','fuzzy','mellow','witty','snappy'];
const PROFILE_NAME_WORD_B = ['racer','drift','pulse','track','echo','comet','storm','shift','vault','spark','dash','glide','runner','rocket','flare','nexus','voyage','blaze','orbit','flux','drive','streak','zenith','quartz','radar','pilot','charger','phantom','matrix','engine','jumper','hopper','sprinter','raider','seeker','keeper','walker','slider','cruiser','strider','booster','chaser','panther','falcon','otter','fox','rhino','yak','wizard','knight','samurai','sage','ranger','captain','doctor','baron','duke','rookie','veteran','legend','maverick','stomper','breaker','spirit','beacon','anchor','vector','module','kernel','vortex','quasar','galaxy','planet','meteor','asteroid','volcano','tsunami','whirl','tempest','charge','vertex','pixel','bit','byte','gear','piston','engineer','driver','rider','climber','surfer','skater','sniper','ace'];
const DEFAULT_NAME_BLOCKLIST = ["admin","moderator","owner","staff","support","system","dev","developer","verified","helper","official","security","abuse","abuser","anal","anus","arse","arsehole","ass","assbag","assclown","assface","assfuck","assfucker","asshat","asshole","assholes","asslicker","asswipe","ballsack","bastard","bastards","beaner","bitch","bitches","bitchy","blowjob","blowjobs","bollock","bollocks","boner","boob","boobs","booty","brothel","bullshit","buttfuck","butthole","cameltoe","chink","clit","clitoris","cock","cocks","coon","crap","cum","cumming","cunt","cunts","dick","dicks","dildo","dildos","dipshit","doggystyle","douche","douchebag","dyke","fag","faggot","faggots","feck","fellatio","fingerbang","fuck","fucked","fucker","fuckers","fuckface","fucking","fuckoff","fuckwit","fuk","gangbang","gaylord","genitals","gook","handjob","hardcore","hentai","hitler","hoe","hoes","horny","incest","jackass","jerkoff","jizz","kike","kkk","kunt","lesbo","lesbian","loli","masturbate","masturbation","milf","motherfucker","motherfucking","muff","nazi","nazism","negro","nigga","nigger","niggers","nipple","nipples","nutjob","orgasm","orgy","pedo","pedophile","penis","piss","pissed","pisser","playboy","poon","poop","porn","porno","pornhub","prostitute","pussy","queef","queer","raped","raper","rapist","rape","retard","rimjob","scrotum","sex","sexy","shit","shits","shitty","shota","sissy","skank","slut","sluts","smegma","spic","spunk","strapon","suck","sucks","testicle","threesome","tit","tits","titties","titty","tranny","twat","vag","vagina","vibrator","virgin","voyeur","wank","wanker","whore","whores","wtf","xxx","xrated","yaoi","zoophile","zoophilia","alqaeda","isis","terrorist","swastika","1488","molest","molester","underage","childporn","cp","suicide","killyourself","kys","racist","racism","whitepower","wetback","spick","gimp","cripple","idiot","moron","stupid","dumbass","shithead","cumshot","cumslut","deepthroat","fisting","gangrape","gfy","goatse","groomer","hooker","hotsex","humping","jackoff","motherfucker","nutsack","pecker","peehole","peeing","pussylicking","rectum","scat","semen","sexcam","sexchat","sexworker","shemale","slapper","sodomize","sodomy","tard","teabagging","towelhead","tubgirl","unclefucker","upskirt","urethra","urine","vulva","wigger","willy","yid"];
const MODERN_HIGH_RISK_TERMS = ['gooning','gooner','goonette','edging','edgeplay','gyatt','gyat','onlyfans','ofans','discordmod','heilhitler','gasjews','killall','kms','killyourself','kys','unaliveyourself','csam','cporn','childlover','minorlover','lolicon','shotacon'];
const COMPACT_SEVERE_TERMS = ['nigger','niggre','nigre','nigga','faggot','chink','kike','spic','wetback','beaner','coon','gook','tranny','fuck','bitch','cunt','rape','rapist','pedophile','molester','childporn','csam','killyourself','whitepower','heilhitler','pornhub','onlyfans','gooning','masterbait','masterbaiting','masterofbaiting'];
const RESERVED_NAME_TERMS = ['admin','administrator','moderator','modteam','owner','staff','support','system','developer','devteam','verified','official','staticquasar931'];
const TARGETED_EXACT_NAMES = Object.freeze(['Kim Jong Un','Ngrachio445','Nigervaan','Stephen Hawking']
  .map(value => normalizeNameForCheck(value).replace(/ /g, '')));

function sanitizeDisplayName(value) {
  const name = String(value || '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, 24);
  return name || 'Guest';
}

function normalizeNameForCheck(value) {
  const confusables = {
    'а':'a','в':'b','с':'c','е':'e','н':'h','і':'i','ј':'j','к':'k','м':'m','о':'o','р':'p','ѕ':'s','т':'t','у':'y','х':'x',
    'α':'a','β':'b','ε':'e','ι':'i','κ':'k','ο':'o','ρ':'p','τ':'t','υ':'y','χ':'x'
  };
  return Array.from(String(value || '').normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, ''), char => confusables[char] || char).join('')
    .replace(/[@4]/g, 'a').replace(/[8]/g, 'b').replace(/[3]/g, 'e')
    .replace(/[1!|]/g, 'i').replace(/[0]/g, 'o').replace(/[5$]/g, 's')
    .replace(/[7+]/g, 't').replace(/[^a-z0-9Ѐ-ӿ぀-ヿ一-鿿]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const PREPARED_NAME_TERMS = Object.freeze(
  DEFAULT_NAME_BLOCKLIST.concat(MODERN_HIGH_RISK_TERMS)
    .map(normalizeNameForCheck)
    .filter(Boolean)
    .map(value => Object.freeze({ value, phrase: value.includes(' ') }))
);
const PREPARED_RESERVED_NAMES = Object.freeze(
  RESERVED_NAME_TERMS.map(value => normalizeNameForCheck(value).replace(/ /g, ''))
);
const PREPARED_SEVERE_NEEDLES = Object.freeze(
  COMPACT_SEVERE_TERMS.map(value => normalizeNameForCheck(value).replace(/ /g, '')).filter(value => value.length >= 4)
);

export function isRequestedBlockedName(value) {
  const clean = sanitizeDisplayName(value);
  const compact = normalizeNameForCheck(clean).replace(/ /g, '');
  if (TARGETED_EXACT_NAMES.includes(compact)) return true;
  const rawCompact = clean.normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u0400-\u04ff\u3040-\u30ff\u4e00-\u9fff]/g, '');
  const suffixLength = rawCompact.match(/\d+$/)?.[0]?.length || 0;
  for (let length = 1; length <= Math.min(6, suffixLength); length += 1) {
    const prefix = normalizeNameForCheck(rawCompact.slice(0, -length)).replace(/ /g, '');
    if (TARGETED_EXACT_NAMES.includes(prefix)) return true;
  }
  return false;
}

export function moderatePublicName(value) {
  const clean = sanitizeDisplayName(value);
  const normalized = normalizeNameForCheck(clean);
  const tokens = normalized.split(' ').filter(Boolean);
  const compact = tokens.join('');
  const sourceLooksObfuscated = /[^a-zA-Z\s]/.test(clean) || tokens.length > 1;
  if (isRequestedBlockedName(clean)) return { blocked: true, reason: 'targeted-exact-name', clean };
  for (const reserved of PREPARED_RESERVED_NAMES) {
    if (compact === reserved) return { blocked: true, reason: 'reserved-name', clean };
  }
  for (const term of PREPARED_NAME_TERMS) {
    if (term.phrase && normalized.includes(term.value)) return { blocked: true, reason: 'unsafe-phrase', clean };
    if (!term.phrase && tokens.includes(term.value)) return { blocked: true, reason: 'unsafe-word', clean };
  }
  for (const needle of PREPARED_SEVERE_NEEDLES) {
    if (compact.includes(needle) && (sourceLooksObfuscated || compact === needle || compact.startsWith(needle) || compact.endsWith(needle))) {
      return { blocked: true, reason: 'obfuscated-unsafe-word', clean };
    }
  }
  return { blocked: false, reason: '', clean };
}
function fallbackName(seed) {
  const hash = Math.abs(Array.from(String(seed || 'racer')).reduce((acc, char) => ((acc * 33) ^ char.charCodeAt(0)) >>> 0, 5381));
  const first = PROFILE_NAME_WORD_A[hash % PROFILE_NAME_WORD_A.length];
  const second = PROFILE_NAME_WORD_B[Math.floor(hash / 13) % PROFILE_NAME_WORD_B.length];
  return `${first}${second}`.slice(0, 24);
}

export function safePublicName(value, accountId = '') {
  const decision = moderatePublicName(value);
  return decision.blocked ? (fallbackName(accountId || decision.clean) || 'Guest') : decision.clean;
}
