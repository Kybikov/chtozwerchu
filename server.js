const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const port = Number(process.env.PORT || 5507);
const root = __dirname;
const rooms = new Map();
const previewCache = new Map();

const presets = [
  { id: "party", name: "Вечірка: всі знають", description: "Хіти, які легко впізнати компанією.", songIds: ["stefania", "plakala", "gusi", "shape-of-you", "bad-guy", "blinding-lights", "uptown-funk", "believer", "dragostea", "barbie-girl", "gangnam-style", "despacito", "waka-waka", "as-it-was", "flowers"] },
  { id: "ua", name: "Українські хіти", description: "Океан Ельзи, KAZKA, Kalush, Go_A та інші.", songIds: ["obiimy", "stefania", "chervona-ruta", "plakala", "gusi", "dodomu", "fortetsia", "vovchytsia", "vilni-liudy", "shum", "bez-boiu", "na-nebi", "vesna", "faino", "tam-de-nas-nema"] },
  { id: "ru", name: "RU/СНД хіти", description: "Найвідоміші російськомовні та СНД-хіти 90-х, 00-х, 10-х і 20-х.", songIds: [] },
  { id: "regional", name: "UA + RU мікс", description: "Українські, російськомовні та регіональні хіти для домашньої гри.", songIds: [] },
  { id: "hits-00", name: "00-ті UA/RU", description: "Ностальгія 2000-х: поп, рок, клубні та телевізійні хіти.", songIds: [] },
  { id: "hits-10", name: "10-ті UA/RU", description: "Великі хіти 2010-х, які часто знають з першої плашки.", songIds: [] },
  { id: "hits-20", name: "20-ті UA/RU", description: "Новіші хіти 2020-х: TikTok, радіо, шоу і чарти.", songIds: [] },
  { id: "global", name: "Світові поп-хіти", description: "Популярні англомовні треки різних років.", songIds: ["smells-like-teen-spirit", "billie-jean", "shape-of-you", "rolling-in-the-deep", "blinding-lights", "bad-guy", "wonderwall", "believer", "uptown-funk", "someone-like-you", "flowers", "as-it-was", "happy", "call-me-maybe", "despacito"] },
  { id: "nostalgia", name: "Ностальгія 90-00", description: "Пісні, які часто знають з перших підказок.", songIds: ["barbie-girl", "dragostea", "toxic", "baby-one-more-time", "californication", "numb", "in-the-end", "crazy-in-love", "umbrella", "viva-la-vida", "lose-yourself", "gangnam-style", "waka-waka", "wonderwall", "billie-jean"] },
  { id: "all", name: "Усі пресети", description: "Максимальний мікс з усієї локальної бази.", songIds: [] }
];

const exactPhrases = {
  "chervona-ruta": [["червону", "руту", "не", "шукай", "вечорами"]],
  "bez-boiu": [["я", "не", "здамся", "без", "бою"]],
  "otaman": [["ой", "у", "лузі", "червона", "калина"]],
  "and-the-boys": [["ой", "у", "лузі", "червона", "калина"]],
  "chervona-kalyna-trad": [["ой", "у", "лузі", "червона", "калина"]],
  "nese-galya-vodu": [["несе", "галя", "воду", "коромисло", "гнеться"]],
  "ty-zh-mene-pidmanula": [["ти", "ж", "мене", "підманула", "ти"]],
  "obiimy": [["обійми", "мене", "обійми", "мене", "обійми"]],
  "stefania": [["Stefania", "mamo", "mamo", "Stefania", "mamo"]],
  "plakala": [["плакала", "і", "знову", "плакала", "вона"]],
  "gusi": [["гуси", "гуси", "гуси", "мої", "гуси"]],
  "dodomu": [["я", "їду", "додому", "там", "де"]],
  "vovchytsia": [["вовчиця", "вовчиця", "ти", "моя", "вовчиця"]],
  "vilni-liudy": [["ми", "вільні", "люди", "вільної", "землі"]],
  "shum": [["шум", "шум", "шум", "зеленесенький", "шум"]],
  "na-nebi": [["на", "небі", "моя", "мила", "на"]],
  "vesna": [["а", "вже", "весна", "а", "вже"]],
  "tam-de-nas-nema": [["там", "де", "нас", "нема", "там"]],
  "dancing-lasha-tumbai": [["dancing", "lasha", "tumbai", "dancing", "lasha"]],
  "vse-budet-horosho": [["все", "будет", "хорошо", "я", "это"]],
  "na-stile": [["мы", "на", "стиле", "на", "стиле"]],
  "taet-led": [["тает", "лед", "между", "нами", "тает"]],
  "rozovoe-vino": [["розовое", "вино", "в", "бокале", "пока"]],
  "samaya-samaya": [["самая", "самая", "ты", "самая", "самая"]],
  "malo-polovin": [["мало", "половин", "мало", "мало", "половин"]],
  "million-alyh-roz": [["миллион", "миллион", "миллион", "алых", "роз"]],
  "pozovi-menya": [["позови", "меня", "с", "собой", "я"]],
  "belie-rozy": [["белые", "розы", "белые", "розы", "беззащитны"]],
  "sedaya-noch": [["седая", "ночь", "и", "только", "ей"]],
  "zvezda-po-imeni-solnce": [["и", "звезда", "по", "имени", "солнце"]],
  "gruppa-krovi": [["группа", "крови", "на", "рукаве", "мой"]],
  "kukushka": [["песен", "еще", "ненаписанных", "сколько", "скажи"]],
  "pachka-sigaret": [["если", "есть", "в", "кармане", "пачка"]],
  "all-the-things": [["all", "the", "things", "she", "said"]],
  "kroshka-moya": [["крошка", "моя", "я", "по", "тебе"]],
  "nas-ne-dogonyat": [["нас", "не", "догонят", "нас", "не"]],
  "ya-soshla-s-uma": [["я", "сошла", "с", "ума", "мне"]],
  "ruchki": [["ну", "где", "же", "ваши", "ручки"]],
  "ty-menya-ne-ishchi": [["ты", "меня", "не", "ищи", "я"]],
  "provence": [["а", "я", "хочу", "в", "прованс"]],
  "na-bolshom-vozdushnom-share": [["на", "большом", "воздушном", "шаре", "мандаринового"]],
  "den-i-noch": [["день", "и", "ночь", "я", "с"]],
  "mama-ya-v-dubae": [["мама", "я", "в", "дубае", "мама"]],
  "gory-po-koleno": [["горы", "по", "колено", "горы", "по"]],
  "zhit-v-kayf": [["выбирай", "жить", "в", "кайф", "жить"]],
  "porichka": [["несу", "тобі", "єдина", "чашку", "кави"]],
  "zaproshu-na-kavu": [["запрошу", "на", "каву", "тебе", "я"]],
  "a-ya-vse-plakala": [["а", "я", "все", "плакала", "плакала"]],
  "shape-of-you": [["I'm", "in", "love", "with", "the"]],
  "blinding-lights": [["I", "said", "ooh", "I'm", "blinded"]],
  "bad-guy": [["white", "shirt", "now", "red", "my"]],
  "smells-like-teen-spirit": [["here", "we", "are", "now", "entertain"]],
  "billie-jean": [["Billie", "Jean", "is", "not", "my"]],
  "wonderwall": [["today", "is", "gonna", "be", "the"]],
  "believer": [["first", "things", "first", "I'ma", "say"]],
  "uptown-funk": [["this", "hit", "that", "ice", "cold"]],
  "someone-like-you": [["never", "mind", "I'll", "find", "someone"]],
  "flowers": [["I", "can", "buy", "myself", "flowers"]],
  "as-it-was": [["you", "know", "it's", "not", "the"]],
  "happy": [["clap", "along", "if", "you", "feel"]],
  "call-me-maybe": [["hey", "I", "just", "met", "you"]],
  "despacito": [["despacito", "quiero", "respirar", "tu", "cuello"]],
  "barbie-girl": [["I'm", "a", "Barbie", "girl", "in"]],
  "dragostea": [["alo", "salut", "sunt", "eu", "un"]],
  "toxic": [["with", "a", "taste", "of", "your"]],
  "baby-one-more-time": [["oh", "baby", "baby", "how", "was"]],
  "numb": [["I've", "become", "so", "numb", "I"]],
  "in-the-end": [["it", "starts", "with", "one", "thing"]],
  "crazy-in-love": [["got", "me", "looking", "so", "crazy"]],
  "umbrella": [["you", "can", "stand", "under", "my"]],
  "viva-la-vida": [["I", "used", "to", "rule", "the"]],
  "lose-yourself": [["his", "palms", "are", "sweaty", "knees"]],
  "gangnam-style": [["oppa", "gangnam", "style", "gangnam", "style"]],
  "waka-waka": [["you're", "a", "good", "soldier", "choosing"]],
  "bohemian-rhapsody": [["is", "this", "the", "real", "life"]],
  "dont-stop-me-now": [["tonight", "I'm", "gonna", "have", "myself"]],
  "we-will-rock-you": [["buddy", "you're", "a", "boy", "make"]],
  "hotel-california": [["on", "a", "dark", "desert", "highway"]],
  "sweet-child-o-mine": [["she's", "got", "a", "smile", "that"]],
  "livin-on-a-prayer": [["Tommy", "used", "to", "work", "on"]],
  "i-will-survive": [["at", "first", "I", "was", "afraid"]],
  "dancing-queen": [["you", "are", "the", "dancing", "queen"]],
  "mamma-mia": [["mamma", "mia", "here", "I", "go"]],
  "take-on-me": [["we're", "talking", "away", "I", "don't"]],
  "careless-whisper": [["I", "feel", "so", "unsure", "as"]],
  "like-a-prayer": [["life", "is", "a", "mystery", "everyone"]],
  "material-girl": [["living", "in", "a", "material", "world"]],
  "beat-it": [["just", "beat", "it", "beat", "it"]],
  "smooth-criminal": [["Annie", "are", "you", "okay", "so"]],
  "girls-just-want": [["girls", "just", "want", "to", "have"]],
  "every-breath": [["every", "breath", "you", "take", "every"]],
  "africa": [["I", "bless", "the", "rains", "down"]],
  "eye-of-the-tiger": [["rising", "up", "back", "on", "the"]],
  "final-countdown": [["it's", "the", "final", "countdown", "the"]],
  "never-gonna-give": [["never", "gonna", "give", "you", "up"]],
  "sweet-dreams": [["sweet", "dreams", "are", "made", "of"]],
  "zombie": [["in", "your", "head", "in", "your"]],
  "creep": [["but", "I'm", "a", "creep", "I'm"]],
  "yellow": [["look", "at", "the", "stars", "look"]],
  "fix-you": [["lights", "will", "guide", "you", "home"]],
  "radioactive": [["I'm", "waking", "up", "to", "ash"]],
  "mr-brightside": [["coming", "out", "of", "my", "cage"]],
  "chandelier": [["I'm", "gonna", "swing", "from", "the"]],
  "cheap-thrills": [["I", "don't", "need", "no", "money"]],
  "diamonds": [["shine", "bright", "like", "a", "diamond"]],
  "single-ladies": [["all", "the", "single", "ladies", "all"]],
  "halo": [["I", "can", "see", "your", "halo"]],
  "havana": [["Havana", "ooh", "na", "na", "half"]],
  "senorita": [["I", "love", "it", "when", "you"]],
  "see-you-again": [["it's", "been", "a", "long", "day"]],
  "closer": [["so", "baby", "pull", "me", "closer"]],
  "wake-me-up": [["so", "wake", "me", "up", "when"]],
  "sorry": [["is", "it", "too", "late", "now"]],
  "love-yourself": [["you", "should", "go", "and", "love"]],
  "bad-romance": [["I", "want", "your", "ugly", "I"]],
  "poker-face": [["can't", "read", "my", "can't", "read"]],
  "shallow": [["tell", "me", "something", "girl", "are"]],
  "firework": [["do", "you", "ever", "feel", "like"]],
  "roar": [["I", "got", "the", "eye", "of"]],
  "blank-space": [["nice", "to", "meet", "you", "where"]],
  "shake-it-off": [["cause", "the", "players", "gonna", "play"]],
  "love-story": [["we", "were", "both", "young", "when"]],
  "hello-adele": [["hello", "from", "the", "other", "side"]],
  "skyfall": [["this", "is", "the", "end", "hold"]],
  "perfect": [["I", "found", "a", "love", "for"]],
  "thinking-out-loud": [["when", "your", "legs", "don't", "work"]],
  "counting-stars": [["lately", "I've", "been", "I've", "been"]],
  "all-of-me": [["cause", "all", "of", "me", "loves"]],
  "stay": [["I", "do", "the", "same", "thing"]],
  "heat-waves": [["sometimes", "all", "I", "think", "about"]],
  "levitating": [["if", "you", "wanna", "run", "away"]],
  "dont-start-now": [["if", "you", "don't", "wanna", "see"]],
  "dance-monkey": [["so", "they", "say", "dance", "for"]],
  "old-town-road": [["I'm", "gonna", "take", "my", "horse"]],
  "sunflower": [["you're", "a", "sunflower", "I", "think"]],
  "starboy": [["I'm", "tryna", "put", "you", "in"]],
  "save-your-tears": [["I", "saw", "you", "dancing", "in"]],
  "drivers-license": [["I", "got", "my", "driver's", "license"]],
  "good-4-u": [["well", "good", "for", "you", "I"]],
  "grenade": [["I'd", "catch", "a", "grenade", "for"]],
  "just-the-way-you-are": [["when", "I", "see", "your", "face"]],
  "when-i-was-your-man": [["I", "should", "have", "bought", "you"]]
};

const songs = [
  song("obiimy", "Обійми", "Океан Ельзи", "ua", ["ніч", "дощ", "тихо", "серце", "руки", "тепло", "небо", "мить", "світло", "поруч"], ["обійми", "обними"]),
  song("stefania", "Стефанія", "Kalush Orchestra", "ua", ["мама", "поле", "дорога", "сила", "слово", "дім", "очі", "колиска", "квітка", "голос"], ["stefania", "стефанія"]),
  song("chervona-ruta", "Червона рута", "Софія Ротару", "ua", ["рута", "вода", "гори", "вечір", "сонце", "очі", "чари", "літо", "дівчина", "квітка"], ["червона рута"]),
  song("plakala", "Плакала", "KAZKA", "ua", ["кухня", "сльози", "ніч", "серце", "мовчати", "зима", "дівчина", "біль", "вікно", "сила"], ["плакала", "kazka плакала"]),
  song("gusi", "Гуси", "Wellboy", "ua", ["гуси", "танці", "село", "друзі", "вечір", "туса", "крила", "хата", "сонце", "дорога"], ["гуси", "вишні"]),
  song("dodomu", "Додому", "Kalush feat. Skofka", "ua", ["дім", "дорога", "мама", "місто", "очі", "ніч", "кроки", "серце", "земля", "свої"], ["додому"]),
  song("fortetsia", "Фортеця Бахмут", "Антитіла", "ua", ["небо", "сила", "фортеця", "земля", "люди", "світло", "дорога", "руки", "день", "віра"], ["фортеця бахмут", "бахмут"]),
  song("vovchytsia", "Вовчиця", "Олег Винник", "ua", ["зорі", "ніч", "очі", "вовчиця", "серце", "степ", "місяць", "любов", "тиша", "сон"], ["вовчиця"]),
  song("vilni-liudy", "Вільні люди", "Без Обмежень", "ua", ["люди", "воля", "небо", "місто", "сила", "крила", "мрія", "серце", "день", "дорога"], ["вільні люди", "вольні люди"]),
  song("shum", "Шум", "Go_A", "ua", ["шум", "весна", "поле", "зелений", "вітер", "танець", "ніч", "сонце", "земля", "гора"], ["шум", "shum"]),
  song("bez-boiu", "Без бою", "Океан Ельзи", "ua", ["бій", "любов", "очі", "серце", "слово", "день", "тиша", "голос", "руки", "ніч"], ["без бою"]),
  song("na-nebi", "На небі", "Океан Ельзи", "ua", ["небо", "зорі", "сонце", "очі", "крила", "серце", "літо", "тиша", "світ", "мрія"], ["на небі"]),
  song("vesna", "Весна", "Воплі Відоплясова", "ua", ["весна", "місто", "очі", "день", "пісня", "сонце", "любов", "дорога", "квіти", "вітер"], ["весна"]),
  song("faino", "Файно", "Тартак", "ua", ["файно", "танці", "день", "місто", "руки", "ніч", "друзі", "музика", "свято", "голос"], ["файно"]),
  song("tam-de-nas-nema", "Там, де нас нема", "Океан Ельзи", "ua", ["там", "небо", "море", "сни", "дорога", "нас", "нема", "світ", "серце", "тиша"], ["там де нас нема", "там де нас нема"]),

  song("smells-like-teen-spirit", "Smells Like Teen Spirit", "Nirvana", "global", ["lights", "dangerous", "entertain", "stupid", "contagious", "hello", "load", "friends", "denial", "memory"], ["teen spirit", "smells like teen spirit"]),
  song("billie-jean", "Billie Jean", "Michael Jackson", "global", ["dance", "floor", "round", "eyes", "chair", "kid", "lover", "truth", "night", "queen"], ["billie jean"]),
  song("shape-of-you", "Shape of You", "Ed Sheeran", "global", ["club", "bar", "magnet", "body", "room", "table", "dance", "heart", "story", "week"], ["shape of you"]),
  song("rolling-in-the-deep", "Rolling in the Deep", "Adele", "global", ["fire", "heart", "dark", "scars", "deep", "wish", "tears", "fever", "home", "ship"], ["rolling in the deep"]),
  song("blinding-lights", "Blinding Lights", "The Weeknd", "global", ["city", "cold", "lights", "night", "touch", "road", "sleep", "phone", "love", "empty"], ["blinding lights"]),
  song("bad-guy", "bad guy", "Billie Eilish", "global", ["white", "shirt", "nose", "bruises", "knees", "type", "tough", "rough", "bad", "sad"], ["bad guy"]),
  song("wonderwall", "Wonderwall", "Oasis", "global", ["today", "road", "fire", "heart", "maybe", "save", "walls", "word", "about", "after"], ["wonderwall"]),
  song("believer", "Believer", "Imagine Dragons", "global", ["pain", "fire", "heart", "believer", "things", "brain", "veins", "life", "face", "ground"], ["believer"]),
  song("uptown-funk", "Uptown Funk", "Mark Ronson feat. Bruno Mars", "global", ["hot", "police", "fireman", "dragon", "saturday", "city", "girls", "funk", "dance", "shoes"], ["uptown funk"]),
  song("someone-like-you", "Someone Like You", "Adele", "global", ["settled", "dreams", "friend", "memories", "time", "blue", "sweet", "glory", "face", "yesterday"], ["someone like you"]),
  song("flowers", "Flowers", "Miley Cyrus", "global", ["flowers", "name", "sand", "hours", "rain", "roses", "talk", "hand", "dance", "love"], ["flowers"]),
  song("as-it-was", "As It Was", "Harry Styles", "global", ["world", "phone", "home", "gravity", "answer", "ringing", "leave", "kids", "good", "alone"], ["as it was"]),
  song("happy", "Happy", "Pharrell Williams", "global", ["happy", "room", "roof", "truth", "news", "clap", "feel", "sunshine", "air", "hot"], ["happy"]),
  song("call-me-maybe", "Call Me Maybe", "Carly Rae Jepsen", "global", ["wish", "well", "penny", "kiss", "look", "baby", "number", "crazy", "call", "maybe"], ["call me maybe"]),
  song("despacito", "Despacito", "Luis Fonsi feat. Daddy Yankee", "global", ["despacito", "pasito", "suave", "favorito", "laberinto", "firma", "manuscrito", "playa", "ritmo", "corazon"], ["despacito"]),
  song("barbie-girl", "Barbie Girl", "Aqua", "global", ["barbie", "plastic", "fantastic", "party", "doll", "world", "imagination", "life", "pink", "girl"], ["barbie girl"]),
  song("dragostea", "Dragostea Din Tei", "O-Zone", "global", ["alo", "salut", "haiduc", "tei", "dragostea", "fericirea", "chipul", "ochii", "vrei", "plec"], ["dragostea din tei", "numa numa"]),
  song("toxic", "Toxic", "Britney Spears", "global", ["taste", "poison", "paradise", "addicted", "dangerous", "toxic", "ride", "high", "cup", "lips"], ["toxic"]),
  song("baby-one-more-time", "...Baby One More Time", "Britney Spears", "global", ["baby", "loneliness", "sign", "mind", "confess", "still", "believe", "hit", "time", "reason"], ["baby one more time", "hit me baby one more time"]),
  song("californication", "Californication", "Red Hot Chili Peppers", "global", ["psychic", "china", "silver", "dream", "station", "california", "edge", "world", "space", "born"], ["californication"]),
  song("numb", "Numb", "Linkin Park", "global", ["tired", "pressure", "caught", "undertow", "mistake", "numb", "faith", "control", "more", "less"], ["numb"]),
  song("in-the-end", "In the End", "Linkin Park", "global", ["time", "thing", "mind", "clock", "pendulum", "unreal", "inside", "effort", "matter", "end"], ["in the end"]),
  song("crazy-in-love", "Crazy in Love", "Beyonce feat. Jay-Z", "global", ["crazy", "love", "look", "touch", "baby", "eyes", "heart", "foolish", "tennis", "dress"], ["crazy in love"]),
  song("umbrella", "Umbrella", "Rihanna feat. Jay-Z", "global", ["umbrella", "rain", "sunshine", "clouds", "friend", "promise", "weather", "heart", "forever", "cars"], ["umbrella"]),
  song("viva-la-vida", "Viva la Vida", "Coldplay", "global", ["world", "seas", "king", "streets", "dice", "fear", "bells", "choirs", "mirror", "sword"], ["viva la vida"]),
  song("lose-yourself", "Lose Yourself", "Eminem", "global", ["palms", "knees", "arms", "sweater", "mom", "spaghetti", "moment", "music", "chance", "lose"], ["lose yourself"]),
  song("gangnam-style", "Gangnam Style", "PSY", "global", ["gangnam", "style", "lady", "coffee", "night", "heart", "baby", "jump", "dress", "horse"], ["gangnam style"]),
  song("waka-waka", "Waka Waka", "Shakira", "global", ["africa", "waka", "time", "pressure", "soldier", "battle", "choose", "shine", "people", "street"], ["waka waka"])
];

const extraCatalog = [
  ["bohemian-rhapsody", "Bohemian Rhapsody", "Queen", "global", ["night", "voices", "queen", "stage", "thunder"], ["bohemian rhapsody"], "nostalgia"],
  ["dont-stop-me-now", "Don't Stop Me Now", "Queen", "global", ["rocket", "sky", "fire", "speed", "tonight"], ["dont stop me now"], "party"],
  ["we-will-rock-you", "We Will Rock You", "Queen", "global", ["stomp", "clap", "crowd", "arena", "chant"], ["we will rock you"], "party"],
  ["hotel-california", "Hotel California", "Eagles", "global", ["desert", "hotel", "night", "mirror", "door"], ["hotel california"], "nostalgia"],
  ["sweet-child-o-mine", "Sweet Child O' Mine", "Guns N' Roses", "global", ["eyes", "child", "sky", "memory", "smile"], ["sweet child o mine"], "nostalgia"],
  ["livin-on-a-prayer", "Livin' on a Prayer", "Bon Jovi", "global", ["work", "dream", "hand", "prayer", "night"], ["living on a prayer", "livin on a prayer"], "party"],
  ["i-will-survive", "I Will Survive", "Gloria Gaynor", "global", ["door", "strength", "heart", "dance", "survive"], ["i will survive"], "party"],
  ["dancing-queen", "Dancing Queen", "ABBA", "global", ["friday", "lights", "dance", "queen", "young"], ["dancing queen"], "party"],
  ["mamma-mia", "Mamma Mia", "ABBA", "global", ["heart", "again", "game", "look", "mamma"], ["mamma mia"], "party"],
  ["take-on-me", "Take On Me", "a-ha", "global", ["sketch", "day", "chase", "take", "away"], ["take on me"], "nostalgia"],
  ["careless-whisper", "Careless Whisper", "George Michael", "global", ["dance", "feet", "guilty", "music", "whisper"], ["careless whisper"], "nostalgia"],
  ["like-a-prayer", "Like a Prayer", "Madonna", "global", ["voice", "prayer", "night", "choir", "dream"], ["like a prayer"], "party"],
  ["material-girl", "Material Girl", "Madonna", "global", ["city", "diamonds", "world", "girl", "shine"], ["material girl"], "party"],
  ["thriller", "Thriller", "Michael Jackson", "global", ["midnight", "shadow", "door", "monster", "thrill"], ["thriller"], "party"],
  ["beat-it", "Beat It", "Michael Jackson", "global", ["street", "fight", "heat", "run", "beat"], ["beat it"], "party"],
  ["smooth-criminal", "Smooth Criminal", "Michael Jackson", "global", ["room", "window", "sound", "smooth", "danger"], ["smooth criminal"], "party"],
  ["girls-just-want", "Girls Just Want to Have Fun", "Cyndi Lauper", "global", ["phone", "sun", "girls", "fun", "night"], ["girls just want to have fun"], "party"],
  ["every-breath", "Every Breath You Take", "The Police", "global", ["breath", "move", "step", "watch", "heart"], ["every breath you take"], "nostalgia"],
  ["africa", "Africa", "Toto", "global", ["rain", "africa", "night", "drums", "sky"], ["africa"], "party"],
  ["eye-of-the-tiger", "Eye of the Tiger", "Survivor", "global", ["street", "fight", "rising", "tiger", "fire"], ["eye of the tiger"], "party"],
  ["final-countdown", "The Final Countdown", "Europe", "global", ["space", "countdown", "trumpet", "crowd", "launch"], ["final countdown", "the final countdown"], "party"],
  ["never-gonna-give", "Never Gonna Give You Up", "Rick Astley", "global", ["promise", "heart", "forever", "never", "give"], ["never gonna give you up"], "party"],
  ["sweet-dreams", "Sweet Dreams", "Eurythmics", "global", ["dreams", "travel", "world", "want", "search"], ["sweet dreams"], "party"],
  ["zombie", "Zombie", "The Cranberries", "global", ["head", "silence", "drums", "zombie", "war"], ["zombie"], "nostalgia"],
  ["creep", "Creep", "Radiohead", "global", ["room", "angel", "skin", "wish", "strange"], ["creep"], "nostalgia"],
  ["yellow", "Yellow", "Coldplay", "global", ["stars", "yellow", "skin", "love", "shine"], ["yellow"], "nostalgia"],
  ["fix-you", "Fix You", "Coldplay", "global", ["lights", "home", "bones", "tears", "fix"], ["fix you"], "party"],
  ["clocks", "Clocks", "Coldplay", "global", ["lights", "home", "time", "sea", "clock"], ["clocks"], "party"],
  ["paradise", "Paradise", "Coldplay", "global", ["girl", "dream", "world", "storm", "paradise"], ["paradise"], "party"],
  ["radioactive", "Radioactive", "Imagine Dragons", "global", ["ashes", "dust", "prison", "radioactive", "wake"], ["radioactive"], "party"],
  ["demons", "Demons", "Imagine Dragons", "global", ["eyes", "dark", "beast", "inside", "demons"], ["demons"], "party"],
  ["thunder", "Thunder", "Imagine Dragons", "global", ["dream", "stage", "lightning", "thunder", "crowd"], ["thunder"], "party"],
  ["seven-nation-army", "Seven Nation Army", "The White Stripes", "global", ["army", "nation", "road", "story", "fight"], ["seven nation army"], "party"],
  ["mr-brightside", "Mr. Brightside", "The Killers", "global", ["bed", "dress", "jealousy", "bright", "night"], ["mr brightside"], "party"],
  ["sex-on-fire", "Sex on Fire", "Kings of Leon", "global", ["night", "alley", "heat", "fire", "desire"], ["sex on fire"], "party"],
  ["use-somebody", "Use Somebody", "Kings of Leon", "global", ["night", "streets", "faces", "somebody", "home"], ["use somebody"], "party"],
  ["chandelier", "Chandelier", "Sia", "global", ["party", "ceiling", "tears", "swing", "chandelier"], ["chandelier"], "party"],
  ["cheap-thrills", "Cheap Thrills", "Sia", "global", ["friday", "money", "dance", "thrills", "radio"], ["cheap thrills"], "party"],
  ["diamonds", "Diamonds", "Rihanna", "global", ["sky", "shine", "bright", "diamonds", "alive"], ["diamonds"], "party"],
  ["only-girl", "Only Girl", "Rihanna", "global", ["world", "girl", "light", "heart", "only"], ["only girl"], "party"],
  ["we-found-love", "We Found Love", "Rihanna", "global", ["hopeless", "place", "light", "love", "found"], ["we found love"], "party"],
  ["single-ladies", "Single Ladies", "Beyonce", "global", ["ring", "club", "hands", "ladies", "dance"], ["single ladies"], "party"],
  ["halo", "Halo", "Beyonce", "global", ["walls", "light", "halo", "face", "grace"], ["halo"], "party"],
  ["love-on-top", "Love On Top", "Beyonce", "global", ["baby", "smile", "top", "love", "higher"], ["love on top"], "party"],
  ["havana", "Havana", "Camila Cabello", "global", ["havana", "heart", "east", "summer", "night"], ["havana"], "party"],
  ["senorita", "Senorita", "Shawn Mendes & Camila Cabello", "global", ["miami", "summer", "touch", "senorita", "moon"], ["senorita"], "party"],
  ["stitches", "Stitches", "Shawn Mendes", "global", ["needle", "thread", "pain", "stitches", "heart"], ["stitches"], "party"],
  ["attention", "Attention", "Charlie Puth", "global", ["attention", "party", "dress", "karma", "heart"], ["attention"], "party"],
  ["see-you-again", "See You Again", "Wiz Khalifa feat. Charlie Puth", "global", ["road", "friend", "family", "again", "home"], ["see you again"], "party"],
  ["closer", "Closer", "The Chainsmokers feat. Halsey", "global", ["rover", "hotel", "closer", "shoulder", "youth"], ["closer"], "party"],
  ["something-just-like-this", "Something Just Like This", "The Chainsmokers & Coldplay", "global", ["heroes", "myths", "kiss", "something", "simple"], ["something just like this"], "party"],
  ["wake-me-up", "Wake Me Up", "Avicii", "global", ["dark", "journey", "young", "wake", "life"], ["wake me up"], "party"],
  ["levels", "Levels", "Avicii", "global", ["feeling", "higher", "dance", "lights", "levels"], ["levels"], "party"],
  ["titanium", "Titanium", "David Guetta feat. Sia", "global", ["shoot", "bullet", "fall", "titanium", "voice"], ["titanium"], "party"],
  ["memories", "Memories", "David Guetta feat. Kid Cudi", "global", ["night", "drinks", "memories", "future", "music"], ["memories"], "party"],
  ["lean-on", "Lean On", "Major Lazer & DJ Snake", "global", ["fire", "blow", "lean", "shoulder", "dance"], ["lean on"], "party"],
  ["let-me-love-you", "Let Me Love You", "DJ Snake feat. Justin Bieber", "global", ["sleep", "dream", "love", "fall", "never"], ["let me love you"], "party"],
  ["sorry", "Sorry", "Justin Bieber", "global", ["sorry", "chance", "heart", "late", "mistake"], ["sorry"], "party"],
  ["love-yourself", "Love Yourself", "Justin Bieber", "global", ["phone", "friends", "love", "yourself", "truth"], ["love yourself"], "party"],
  ["baby", "Baby", "Justin Bieber", "global", ["baby", "heart", "first", "love", "school"], ["baby"], "party"],
  ["what-do-you-mean", "What Do You Mean?", "Justin Bieber", "global", ["mean", "clock", "head", "yes", "no"], ["what do you mean"], "party"],
  ["bad-romance", "Bad Romance", "Lady Gaga", "global", ["romance", "want", "drama", "love", "revenge"], ["bad romance"], "party"],
  ["poker-face", "Poker Face", "Lady Gaga", "global", ["cards", "face", "game", "love", "poker"], ["poker face"], "party"],
  ["shallow", "Shallow", "Lady Gaga & Bradley Cooper", "global", ["shallow", "deep", "surface", "stars", "voice"], ["shallow"], "party"],
  ["just-dance", "Just Dance", "Lady Gaga", "global", ["club", "drink", "spin", "dance", "okay"], ["just dance"], "party"],
  ["firework", "Firework", "Katy Perry", "global", ["spark", "sky", "firework", "night", "color"], ["firework"], "party"],
  ["roar", "Roar", "Katy Perry", "global", ["tiger", "champion", "voice", "roar", "loud"], ["roar"], "party"],
  ["dark-horse", "Dark Horse", "Katy Perry", "global", ["magic", "storm", "horse", "heart", "choice"], ["dark horse"], "party"],
  ["hot-n-cold", "Hot N Cold", "Katy Perry", "global", ["hot", "cold", "yes", "no", "change"], ["hot n cold", "hot and cold"], "party"],
  ["blank-space", "Blank Space", "Taylor Swift", "global", ["names", "list", "blank", "space", "game"], ["blank space"], "party"],
  ["shake-it-off", "Shake It Off", "Taylor Swift", "global", ["players", "haters", "shake", "dance", "off"], ["shake it off"], "party"],
  ["love-story", "Love Story", "Taylor Swift", "global", ["balcony", "romeo", "juliet", "story", "yes"], ["love story"], "party"],
  ["anti-hero", "Anti-Hero", "Taylor Swift", "global", ["midnight", "mirror", "problem", "hero", "alone"], ["anti hero"], "party"],
  ["bad-blood", "Bad Blood", "Taylor Swift", "global", ["blood", "scars", "battle", "team", "bad"], ["bad blood"], "party"],
  ["hello-adele", "Hello", "Adele", "global", ["hello", "years", "outside", "sorry", "home"], ["hello"], "party"],
  ["skyfall", "Skyfall", "Adele", "global", ["sky", "fall", "stand", "tall", "together"], ["skyfall"], "party"],
  ["set-fire-to-rain", "Set Fire to the Rain", "Adele", "global", ["rain", "fire", "hands", "face", "burn"], ["set fire to the rain"], "party"],
  ["perfect", "Perfect", "Ed Sheeran", "global", ["barefoot", "grass", "song", "perfect", "dance"], ["perfect"], "party"],
  ["thinking-out-loud", "Thinking Out Loud", "Ed Sheeran", "global", ["arms", "seventy", "heart", "loud", "love"], ["thinking out loud"], "party"],
  ["bad-habits", "Bad Habits", "Ed Sheeran", "global", ["night", "habits", "strangers", "late", "lose"], ["bad habits"], "party"],
  ["photograph", "Photograph", "Ed Sheeran", "global", ["photo", "memory", "pocket", "heart", "home"], ["photograph"], "party"],
  ["counting-stars", "Counting Stars", "OneRepublic", "global", ["stars", "money", "river", "dream", "counting"], ["counting stars"], "party"],
  ["apologize", "Apologize", "OneRepublic", "global", ["rope", "ground", "late", "sorry", "apologize"], ["apologize"], "nostalgia"],
  ["all-of-me", "All of Me", "John Legend", "global", ["curves", "edges", "cards", "all", "love"], ["all of me"], "party"],
  ["stay", "Stay", "The Kid LAROI & Justin Bieber", "global", ["stay", "mistake", "promise", "need", "late"], ["stay"], "party"],
  ["heat-waves", "Heat Waves", "Glass Animals", "global", ["heat", "waves", "night", "road", "dream"], ["heat waves"], "party"],
  ["levitating", "Levitating", "Dua Lipa", "global", ["moonlight", "starlight", "levitating", "dance", "galaxy"], ["levitating"], "party"],
  ["dont-start-now", "Don't Start Now", "Dua Lipa", "global", ["walk", "away", "start", "now", "dance"], ["dont start now"], "party"],
  ["new-rules", "New Rules", "Dua Lipa", "global", ["rules", "phone", "door", "friend", "count"], ["new rules"], "party"],
  ["dance-monkey", "Dance Monkey", "Tones and I", "global", ["dance", "monkey", "shine", "hands", "repeat"], ["dance monkey"], "party"],
  ["watermelon-sugar", "Watermelon Sugar", "Harry Styles", "global", ["summer", "watermelon", "sugar", "taste", "high"], ["watermelon sugar"], "party"],
  ["sign-of-the-times", "Sign of the Times", "Harry Styles", "global", ["times", "sky", "cry", "door", "bullet"], ["sign of the times"], "party"],
  ["old-town-road", "Old Town Road", "Lil Nas X", "global", ["horse", "road", "hat", "boots", "town"], ["old town road"], "party"],
  ["sunflower", "Sunflower", "Post Malone & Swae Lee", "global", ["sunflower", "wreck", "dust", "love", "run"], ["sunflower"], "party"],
  ["rockstar", "Rockstar", "Post Malone", "global", ["rockstar", "cars", "guitar", "night", "fame"], ["rockstar"], "party"],
  ["circles", "Circles", "Post Malone", "global", ["circle", "run", "season", "love", "again"], ["circles"], "party"],
  ["starboy", "Starboy", "The Weeknd", "global", ["starboy", "cars", "house", "money", "night"], ["starboy"], "party"],
  ["cant-feel-my-face", "Can't Feel My Face", "The Weeknd", "global", ["face", "love", "danger", "touch", "numb"], ["cant feel my face"], "party"],
  ["save-your-tears", "Save Your Tears", "The Weeknd", "global", ["tears", "crowd", "face", "save", "night"], ["save your tears"], "party"],
  ["drivers-license", "drivers license", "Olivia Rodrigo", "global", ["license", "street", "suburbs", "cry", "drive"], ["drivers license"], "party"],
  ["good-4-u", "good 4 u", "Olivia Rodrigo", "global", ["good", "happy", "therapy", "fire", "cry"], ["good 4 u", "good for you"], "party"],
  ["vampire", "vampire", "Olivia Rodrigo", "global", ["vampire", "fame", "night", "blood", "love"], ["vampire"], "party"],
  ["espresso", "Espresso", "Sabrina Carpenter", "global", ["espresso", "dream", "night", "sweet", "work"], ["espresso"], "party"],
  ["please-please-please", "Please Please Please", "Sabrina Carpenter", "global", ["please", "heart", "actor", "floor", "promise"], ["please please please"], "party"],
  ["bad-habits-shawn", "There's Nothing Holdin' Me Back", "Shawn Mendes", "global", ["holding", "back", "crazy", "follow", "free"], ["theres nothing holdin me back"], "party"],
  ["grenade", "Grenade", "Bruno Mars", "global", ["grenade", "train", "blade", "pain", "love"], ["grenade"], "party"],
  ["just-the-way-you-are", "Just the Way You Are", "Bruno Mars", "global", ["eyes", "smile", "stars", "way", "beautiful"], ["just the way you are"], "party"],
  ["locked-out-of-heaven", "Locked Out of Heaven", "Bruno Mars", "global", ["heaven", "door", "light", "love", "locked"], ["locked out of heaven"], "party"],
  ["when-i-was-your-man", "When I Was Your Man", "Bruno Mars", "global", ["flowers", "dance", "hands", "man", "late"], ["when i was your man"], "party"],
  ["payphone", "Payphone", "Maroon 5", "global", ["payphone", "change", "plans", "story", "home"], ["payphone"], "party"],
  ["moves-like-jagger", "Moves Like Jagger", "Maroon 5", "global", ["moves", "jagger", "tongue", "dance", "control"], ["moves like jagger"], "party"],
  ["sugar", "Sugar", "Maroon 5", "global", ["sugar", "sweet", "need", "love", "down"], ["sugar"], "party"],
  ["memories-maroon", "Memories", "Maroon 5", "global", ["toast", "memories", "ones", "lost", "today"], ["memories"], "party"],
  ["let-her-go", "Let Her Go", "Passenger", "global", ["light", "snow", "road", "love", "go"], ["let her go"], "party"],
  ["riptide", "Riptide", "Vance Joy", "global", ["riptide", "dark", "movie", "girl", "song"], ["riptide"], "party"],
  ["ho-hey", "Ho Hey", "The Lumineers", "global", ["belong", "sweetheart", "ho", "hey", "home"], ["ho hey"], "party"],
  ["somebody-that-i-used-to-know", "Somebody That I Used to Know", "Gotye feat. Kimbra", "global", ["somebody", "used", "know", "cut", "stranger"], ["somebody that i used to know"], "party"],
  ["pumped-up-kicks", "Pumped Up Kicks", "Foster the People", "global", ["kicks", "run", "faster", "kids", "gun"], ["pumped up kicks"], "party"],
  ["shut-up-and-dance", "Shut Up and Dance", "Walk the Moon", "global", ["dance", "woman", "night", "backless", "shoes"], ["shut up and dance"], "party"],
  ["cake-by-the-ocean", "Cake by the Ocean", "DNCE", "global", ["cake", "ocean", "party", "waves", "sweet"], ["cake by the ocean"], "party"],
  ["all-star", "All Star", "Smash Mouth", "global", ["star", "game", "world", "roll", "shine"], ["all star"], "nostalgia"],
  ["hey-ya", "Hey Ya!", "Outkast", "global", ["shake", "picture", "hey", "ya", "party"], ["hey ya"], "party"],
  ["ms-jackson", "Ms. Jackson", "Outkast", "global", ["sorry", "jackson", "daughter", "rain", "forever"], ["ms jackson"], "nostalgia"],
  ["get-lucky", "Get Lucky", "Daft Punk feat. Pharrell Williams", "global", ["night", "sun", "lucky", "good", "fun"], ["get lucky"], "party"],
  ["one-more-time", "One More Time", "Daft Punk", "global", ["celebrate", "dance", "free", "one", "time"], ["one more time"], "party"],
  ["around-the-world", "Around the World", "Daft Punk", "global", ["around", "world", "repeat", "beat", "lights"], ["around the world"], "party"],
  ["blue-da-ba-dee", "Blue", "Eiffel 65", "global", ["blue", "house", "window", "world", "song"], ["blue", "blue da ba dee"], "nostalgia"],
  ["what-is-love", "What Is Love", "Haddaway", "global", ["love", "hurt", "baby", "question", "dance"], ["what is love"], "nostalgia"],
  ["sandstorm", "Sandstorm", "Darude", "global", ["sand", "storm", "rave", "speed", "lights"], ["sandstorm"], "party"],
  ["freed-from-desire", "Freed from Desire", "Gala", "global", ["desire", "mind", "strong", "free", "love"], ["freed from desire"], "party"],
  ["satisfaction", "Satisfaction", "Benny Benassi", "global", ["push", "touch", "satisfaction", "beat", "club"], ["satisfaction"], "party"],
  ["sweater-weather", "Sweater Weather", "The Neighbourhood", "global", ["sweater", "weather", "hands", "shorts", "cold"], ["sweater weather"], "party"],
  ["habits", "Habits", "Tove Lo", "global", ["habits", "club", "night", "high", "forget"], ["habits", "stay high"], "party"],
  ["somebody-to-love", "Somebody to Love", "Queen", "global", ["somebody", "love", "morning", "work", "prayer"], ["somebody to love"], "party"],
  ["lets-get-it-started", "Let's Get It Started", "The Black Eyed Peas", "global", ["started", "party", "floor", "energy", "now"], ["lets get it started"], "party"],
  ["i-gotta-feeling", "I Gotta Feeling", "The Black Eyed Peas", "global", ["feeling", "tonight", "good", "party", "woo"], ["i gotta feeling"], "party"],
  ["where-is-the-love", "Where Is the Love?", "The Black Eyed Peas", "global", ["world", "people", "love", "question", "peace"], ["where is the love"], "nostalgia"],
  ["cant-stop-feeling", "CAN'T STOP THE FEELING!", "Justin Timberlake", "global", ["sunshine", "pocket", "soul", "dance", "feeling"], ["cant stop the feeling"], "party"],
  ["cry-me-a-river", "Cry Me a River", "Justin Timberlake", "global", ["river", "cry", "bridge", "truth", "gone"], ["cry me a river"], "nostalgia"],
  ["mirrors", "Mirrors", "Justin Timberlake", "global", ["mirror", "other", "half", "reflection", "love"], ["mirrors"], "party"],
  ["yeah", "Yeah!", "Usher feat. Lil Jon & Ludacris", "global", ["club", "yeah", "floor", "shorty", "dance"], ["yeah"], "party"],
  ["without-me", "Without Me", "Eminem", "global", ["back", "guess", "shady", "problem", "music"], ["without me"], "party"],
  ["stan", "Stan", "Eminem feat. Dido", "global", ["letter", "fan", "rain", "window", "story"], ["stan"], "nostalgia"],
  ["the-real-slim-shady", "The Real Slim Shady", "Eminem", "global", ["real", "shady", "stand", "problem", "crowd"], ["the real slim shady"], "party"],
  ["mockingbird", "Mockingbird", "Eminem", "global", ["bird", "baby", "family", "promise", "song"], ["mockingbird"], "party"],
  ["stronger", "Stronger", "Kanye West", "global", ["harder", "better", "faster", "stronger", "night"], ["stronger"], "party"],
  ["gold-digger", "Gold Digger", "Kanye West feat. Jamie Foxx", "global", ["money", "gold", "digger", "story", "club"], ["gold digger"], "party"],
  ["hotline-bling", "Hotline Bling", "Drake", "global", ["phone", "hotline", "bling", "late", "city"], ["hotline bling"], "party"],
  ["gods-plan", "God's Plan", "Drake", "global", ["plan", "road", "love", "family", "bless"], ["gods plan"], "party"],
  ["one-dance", "One Dance", "Drake", "global", ["dance", "hennessy", "hands", "time", "baby"], ["one dance"], "party"],
  ["bad-and-boujee", "Bad and Boujee", "Migos", "global", ["bad", "boujee", "rain", "money", "cars"], ["bad and boujee"], "party"],
  ["humble", "HUMBLE.", "Kendrick Lamar", "global", ["humble", "sit", "down", "truth", "crown"], ["humble"], "party"],
  ["sicko-mode", "SICKO MODE", "Travis Scott", "global", ["mode", "night", "city", "switch", "ride"], ["sicko mode"], "party"],
  ["goosebumps", "goosebumps", "Travis Scott", "global", ["goosebumps", "night", "love", "side", "feel"], ["goosebumps"], "party"],
  ["lucid-dreams", "Lucid Dreams", "Juice WRLD", "global", ["dreams", "shadows", "heart", "sleep", "lucid"], ["lucid dreams"], "party"],
  ["bad-habits-juice", "All Girls Are The Same", "Juice WRLD", "global", ["girls", "same", "heart", "pain", "room"], ["all girls are the same"], "party"],
  ["starships", "Starships", "Nicki Minaj", "global", ["starships", "fly", "hands", "beach", "party"], ["starships"], "party"],
  ["super-bass", "Super Bass", "Nicki Minaj", "global", ["bass", "heart", "boom", "boys", "beat"], ["super bass"], "party"],
  ["anaconda", "Anaconda", "Nicki Minaj", "global", ["anaconda", "jungle", "dance", "bass", "club"], ["anaconda"], "party"],
  ["work", "Work", "Rihanna feat. Drake", "global", ["work", "phone", "body", "time", "dance"], ["work"], "party"],
  ["temperature", "Temperature", "Sean Paul", "global", ["temperature", "girl", "dance", "heat", "night"], ["temperature"], "party"],
  ["cheap-thrills-party", "Danza Kuduro", "Don Omar feat. Lucenzo", "global", ["danza", "kuduro", "hands", "sun", "party"], ["danza kuduro"], "party"],
  ["hips-dont-lie", "Hips Don't Lie", "Shakira feat. Wyclef Jean", "global", ["hips", "lie", "dance", "woman", "truth"], ["hips dont lie"], "party"],
  ["whenever-wherever", "Whenever, Wherever", "Shakira", "global", ["mountains", "ocean", "wherever", "lucky", "love"], ["whenever wherever"], "party"],
  ["la-isla-bonita", "La Isla Bonita", "Madonna", "global", ["island", "breeze", "tropical", "bonita", "dream"], ["la isla bonita"], "party"],
  ["macarena", "Macarena", "Los Del Rio", "global", ["macarena", "dance", "arms", "party", "hey"], ["macarena"], "party"],
  ["lambada", "Lambada", "Kaoma", "global", ["lambada", "summer", "dance", "tears", "sea"], ["lambada"], "party"],
  ["bella-ciao", "Bella Ciao", "Traditional", "global", ["morning", "bella", "ciao", "mountain", "freedom"], ["bella ciao"], "party"],
  ["rasputin", "Rasputin", "Boney M.", "global", ["russia", "queen", "dance", "rasputin", "night"], ["rasputin"], "party"],
  ["daddy-cool", "Daddy Cool", "Boney M.", "global", ["daddy", "cool", "crazy", "party", "groove"], ["daddy cool"], "party"],
  ["rivers-of-babylon", "Rivers of Babylon", "Boney M.", "global", ["rivers", "babylon", "song", "home", "tears"], ["rivers of babylon"], "nostalgia"],
  ["last-christmas", "Last Christmas", "Wham!", "global", ["christmas", "heart", "gift", "next", "year"], ["last christmas"], "party"],
  ["all-i-want-for-christmas", "All I Want for Christmas Is You", "Mariah Carey", "global", ["christmas", "tree", "wish", "you", "snow"], ["all i want for christmas is you"], "party"],
  ["jingle-bell-rock", "Jingle Bell Rock", "Bobby Helms", "global", ["jingle", "bell", "rock", "snow", "dance"], ["jingle bell rock"], "party"],
  ["ai-se-eu-te-pego", "Ai Se Eu Te Pego", "Michel Telo", "global", ["nossa", "assim", "voce", "dance", "pego"], ["ai se eu te pego"], "party"],
  ["gasolina", "Gasolina", "Daddy Yankee", "global", ["gasolina", "night", "engine", "club", "move"], ["gasolina"], "party"],
  ["con-calma", "Con Calma", "Daddy Yankee", "global", ["calma", "dance", "girl", "rhythm", "party"], ["con calma"], "party"],
  ["la-camisa-negra", "La Camisa Negra", "Juanes", "global", ["camisa", "negra", "heart", "pain", "night"], ["la camisa negra"], "party"],
  ["bailando", "Bailando", "Enrique Iglesias", "global", ["bailando", "body", "music", "night", "love"], ["bailando"], "party"],
  ["hero-enrique", "Hero", "Enrique Iglesias", "global", ["hero", "kiss", "save", "heart", "night"], ["hero"], "party"],
  ["taki-taki", "Taki Taki", "DJ Snake feat. Selena Gomez, Ozuna & Cardi B", "global", ["taki", "rumba", "party", "dance", "night"], ["taki taki"], "party"],
  ["mi-gente", "Mi Gente", "J Balvin & Willy William", "global", ["gente", "world", "dance", "rhythm", "party"], ["mi gente"], "party"],
  ["la-cancion", "LA CANCIÓN", "J Balvin & Bad Bunny", "global", ["cancion", "bar", "memory", "night", "love"], ["la cancion"], "party"],
  ["dakiti", "DAKITI", "Bad Bunny & Jhay Cortez", "global", ["dakiti", "beach", "night", "eyes", "dance"], ["dakiti"], "party"],
  ["montero", "MONTERO", "Lil Nas X", "global", ["montero", "garden", "call", "name", "night"], ["montero", "call me by your name"], "party"],
  ["industry-baby", "INDUSTRY BABY", "Lil Nas X & Jack Harlow", "global", ["industry", "baby", "champion", "horns", "win"], ["industry baby"], "party"],
  ["positions", "positions", "Ariana Grande", "global", ["positions", "kitchen", "bedroom", "love", "switch"], ["positions"], "party"],
  ["thank-u-next", "thank u, next", "Ariana Grande", "global", ["thank", "next", "love", "lessons", "name"], ["thank u next", "thank you next"], "party"],
  ["seven-rings", "7 rings", "Ariana Grande", "global", ["rings", "hair", "diamonds", "things", "want"], ["7 rings", "seven rings"], "party"],
  ["into-you", "Into You", "Ariana Grande", "global", ["little", "dangerous", "touch", "into", "you"], ["into you"], "party"],
  ["no-tears-left-to-cry", "no tears left to cry", "Ariana Grande", "global", ["tears", "cry", "pick", "up", "loving"], ["no tears left to cry"], "party"],
  ["bad-at-love", "Bad at Love", "Halsey", "global", ["love", "bad", "stories", "city", "heart"], ["bad at love"], "party"],
  ["without-me-halsey", "Without Me", "Halsey", "global", ["found", "heart", "high", "fall", "without"], ["without me"], "party"],
  ["closer-halsey", "Colors", "Halsey", "global", ["colors", "blue", "grey", "hands", "story"], ["colors"], "party"],
  ["royals", "Royals", "Lorde", "global", ["royals", "gold", "diamonds", "postcode", "queen"], ["royals"], "party"],
  ["team-lorde", "Team", "Lorde", "global", ["team", "cities", "dreams", "queen", "call"], ["team"], "party"],
  ["green-light", "Green Light", "Lorde", "global", ["green", "light", "floor", "truth", "night"], ["green light"], "party"],
  ["ocean-eyes", "Ocean Eyes", "Billie Eilish", "global", ["ocean", "eyes", "burn", "fall", "fear"], ["ocean eyes"], "party"],
  ["everything-i-wanted", "everything i wanted", "Billie Eilish", "global", ["dream", "wanted", "water", "night", "care"], ["everything i wanted"], "party"],
  ["happier-than-ever", "Happier Than Ever", "Billie Eilish", "global", ["happier", "ever", "home", "phone", "alone"], ["happier than ever"], "party"],
  ["bury-a-friend", "bury a friend", "Billie Eilish", "global", ["friend", "monster", "bed", "step", "dark"], ["bury a friend"], "party"],
  ["lovely", "lovely", "Billie Eilish & Khalid", "global", ["lovely", "glass", "mind", "stone", "home"], ["lovely"], "party"],
  ["youngblood", "Youngblood", "5 Seconds of Summer", "global", ["youngblood", "call", "dead", "love", "need"], ["youngblood"], "party"],
  ["she-looks-so-perfect", "She Looks So Perfect", "5 Seconds of Summer", "global", ["perfect", "american", "apparel", "floor", "song"], ["she looks so perfect"], "party"],
  ["story-of-my-life", "Story of My Life", "One Direction", "global", ["story", "life", "walls", "heart", "time"], ["story of my life"], "party"],
  ["what-makes-you-beautiful", "What Makes You Beautiful", "One Direction", "global", ["beautiful", "room", "light", "smile", "everyone"], ["what makes you beautiful"], "party"],
  ["drag-me-down", "Drag Me Down", "One Direction", "global", ["fire", "heart", "drag", "down", "strength"], ["drag me down"], "party"],
  ["perfect-one-direction", "Perfect", "One Direction", "global", ["perfect", "trouble", "night", "windows", "story"], ["perfect"], "party"],
  ["dynamite-bts", "Dynamite", "BTS", "global", ["stars", "funk", "soul", "dynamite", "night"], ["dynamite"], "party"],
  ["butter-bts", "Butter", "BTS", "global", ["smooth", "butter", "criminal", "mirror", "dance"], ["butter"], "party"],
  ["gangnam-style-bts", "Boy With Luv", "BTS feat. Halsey", "global", ["boy", "love", "sky", "wings", "day"], ["boy with luv"], "party"],
  ["how-you-like-that", "How You Like That", "BLACKPINK", "global", ["blackpink", "sky", "fall", "look", "that"], ["how you like that"], "party"],
  ["kill-this-love", "Kill This Love", "BLACKPINK", "global", ["love", "kill", "trumpet", "tears", "fire"], ["kill this love"], "party"],
  ["dddu-du-dddu-du", "DDU-DU DDU-DU", "BLACKPINK", "global", ["blackpink", "shot", "ddu", "du", "move"], ["ddu du ddu du"], "party"],
  ["baby-shark", "Baby Shark", "Pinkfong", "global", ["baby", "shark", "doo", "family", "sea"], ["baby shark"], "party"],
  ["let-it-go", "Let It Go", "Idina Menzel", "global", ["snow", "queen", "door", "cold", "free"], ["let it go"], "party"],
  ["hakuna-matata", "Hakuna Matata", "The Lion King", "global", ["hakuna", "matata", "problem", "free", "jungle"], ["hakuna matata"], "party"],
  ["can-you-feel-the-love-tonight", "Can You Feel the Love Tonight", "Elton John", "global", ["night", "love", "feel", "kingdom", "sky"], ["can you feel the love tonight"], "party"],
  ["circle-of-life", "Circle of Life", "Elton John", "global", ["circle", "life", "sun", "savanna", "king"], ["circle of life"], "party"],
  ["my-heart-will-go-on", "My Heart Will Go On", "Celine Dion", "global", ["heart", "near", "far", "ship", "dream"], ["my heart will go on"], "party"],
  ["i-will-always-love-you", "I Will Always Love You", "Whitney Houston", "global", ["always", "love", "goodbye", "memory", "voice"], ["i will always love you"], "party"],
  ["i-wanna-dance-with-somebody", "I Wanna Dance with Somebody", "Whitney Houston", "global", ["clock", "sun", "dance", "somebody", "heat"], ["i wanna dance with somebody"], "party"],
  ["girls-like-you", "Girls Like You", "Maroon 5 feat. Cardi B", "global", ["girls", "you", "night", "need", "love"], ["girls like you"], "party"],
  ["bad-day", "Bad Day", "Daniel Powter", "global", ["bad", "day", "blue", "smile", "turn"], ["bad day"], "nostalgia"],
  ["youre-beautiful", "You're Beautiful", "James Blunt", "global", ["beautiful", "subway", "angel", "crowd", "smile"], ["youre beautiful"], "nostalgia"],
  ["torn", "Torn", "Natalie Imbruglia", "global", ["torn", "cold", "floor", "illusion", "wide"], ["torn"], "nostalgia"],
  ["bring-me-to-life", "Bring Me to Life", "Evanescence", "global", ["wake", "inside", "save", "life", "dark"], ["bring me to life"], "nostalgia"],
  ["my-immortal", "My Immortal", "Evanescence", "global", ["wounds", "heal", "pain", "immortal", "ghost"], ["my immortal"], "nostalgia"],
  ["complicated", "Complicated", "Avril Lavigne", "global", ["complicated", "clothes", "cool", "face", "life"], ["complicated"], "nostalgia"],
  ["sk8er-boi", "Sk8er Boi", "Avril Lavigne", "global", ["skater", "boy", "girl", "stage", "later"], ["sk8er boi", "skater boy"], "nostalgia"],
  ["girlfriend", "Girlfriend", "Avril Lavigne", "global", ["girlfriend", "hey", "you", "like", "better"], ["girlfriend"], "party"],
  ["bring-it-all-back", "Bring It All Back", "S Club 7", "global", ["dreams", "back", "world", "shine", "believe"], ["bring it all back"], "nostalgia"],
  ["wannabe", "Wannabe", "Spice Girls", "global", ["zig", "zag", "friendship", "lover", "wannabe"], ["wannabe"], "party"],
  ["stop-spice", "Stop", "Spice Girls", "global", ["stop", "thank", "very", "much", "dance"], ["stop"], "party"],
  ["believe-cher", "Believe", "Cher", "global", ["believe", "life", "love", "after", "strong"], ["believe"], "party"],
  ["smooth-santana", "Smooth", "Santana feat. Rob Thomas", "global", ["smooth", "summer", "moon", "spanish", "guitar"], ["smooth"], "nostalgia"]
];

const regionalCatalog = [
  ["vse-bude-dobre", "Все буде добре", "Океан Ельзи", "ua", ["все", "буде", "добре", "серце", "вірить"], ["все буде добре"], "00"],
  ["ya-ne-zdamsia", "Я не здамся без бою", "Океан Ельзи", "ua", ["я", "не", "здамся", "без", "бою"], ["я не здамся без бою"], "00"],
  ["911-oe", "911", "Океан Ельзи", "ua", ["дзвінок", "ніч", "допомога", "серце", "місто"], ["911"], "00"],
  ["kvitka-okean", "Квітка", "Океан Ельзи", "ua", ["квітка", "ніч", "весна", "очі", "мрія"], ["квітка"], "00"],
  ["vidpusti", "Відпусти", "Океан Ельзи", "ua", ["відпусти", "мене", "ніч", "сльози", "тиша"], ["відпусти"], "00"],
  ["ne-tvoya-viyna", "Не твоя війна", "Океан Ельзи", "ua", ["не", "твоя", "війна", "серце", "земля"], ["не твоя війна"], "10"],
  ["tam-u-topoli", "Там у тополі", "Океан Ельзи", "ua", ["там", "у", "тополі", "вітер", "стоїть"], ["там у тополі"], "10"],
  ["na-linii-vognyu", "На лінії вогню", "Океан Ельзи", "ua", ["лінія", "вогню", "очі", "серце", "тиша"], ["на лінії вогню"], "20"],
  ["bilya-topoli", "Біля тополі", "SHUMEI", "ua", ["біля", "тополі", "ніч", "земля", "память"], ["біля тополі"], "20"],
  ["tryvoha", "Тривога", "KOLA", "ua", ["тривога", "серце", "місто", "ніч", "дихання"], ["тривога"], "20"],
  ["lyudy", "Люди", "KOLA", "ua", ["люди", "поруч", "очі", "світло", "тепло"], ["люди"], "20"],
  ["bilya-sertsya", "Біля серця", "KOLA", "ua", ["біля", "серця", "тихо", "тримаю", "світ"], ["біля серця"], "20"],
  ["poryad", "Поряд", "KOLA", "ua", ["поряд", "ти", "мій", "спокій", "завжди"], ["поряд"], "20"],
  ["chekay", "Чекай", "KOLA", "ua", ["чекай", "мене", "дощ", "ніч", "вікно"], ["чекай"], "20"],
  ["baraban", "Барабан", "Артем Пивоваров", "ua", ["серце", "барабан", "ритм", "руки", "ніч"], ["барабан"], "20"],
  ["manifest", "Маніфест", "Артем Пивоваров", "ua", ["маніфест", "голос", "воля", "сцена", "світ"], ["маніфест"], "20"],
  ["rendezvous", "Рандеву", "Артем Пивоваров", "ua", ["рандеву", "ніч", "місто", "очі", "зустріч"], ["рандеву"], "20"],
  ["dezhavyu", "Дежавю", "Артем Пивоваров", "ua", ["дежа", "вю", "танець", "світло", "місто"], ["дежавю"], "20"],
  ["dumay-pro-mene", "Думай про мене", "Артем Пивоваров", "ua", ["думай", "про", "мене", "ніч", "серце"], ["думай про мене"], "20"],
  ["varto-chi-ni", "Варто чи ні", "Артем Пивоваров", "ua", ["варто", "чи", "ні", "любов", "питання"], ["варто чи ні"], "10"],
  ["vidvedi", "Відведи", "The Hardkiss", "ua", ["відведи", "мене", "ніч", "вогонь", "місто"], ["відведи"], "10"],
  ["zhuravli", "Журавлі", "The Hardkiss", "ua", ["журавлі", "небо", "крила", "даль", "сум"], ["журавлі"], "10"],
  ["korabli", "Кораблі", "The Hardkiss", "ua", ["кораблі", "море", "вогні", "даль", "ніч"], ["кораблі"], "10"],
  ["melodiya", "Мелодія", "The Hardkiss", "ua", ["мелодія", "серце", "тиша", "голос", "ніч"], ["мелодія"], "20"],
  ["make-up-hardkiss", "Make-Up", "The Hardkiss", "ua", ["make", "up", "дзеркало", "ніч", "сцена"], ["make up"], "10"],
  ["kokhantsi", "Коханці", "The Hardkiss", "ua", ["коханці", "ніч", "місто", "вогні", "таємниця"], ["коханці"], "10"],
  ["bez-tebe", "Без тебе", "Тіна Кароль", "ua", ["без", "тебе", "ніч", "сльози", "порожньо"], ["без тебе"], "00"],
  ["vyshche-hmar", "Вище хмар", "Тіна Кароль", "ua", ["вище", "хмар", "летіти", "серце", "небо"], ["вище хмар"], "00"],
  ["ukraina-tse-ty", "Україна - це ти", "Тіна Кароль", "ua", ["україна", "це", "ти", "серце", "дім"], ["україна це ти"], "10"],
  ["vilna", "Вільна", "Тіна Кароль & Юлія Саніна", "ua", ["вільна", "я", "небо", "сила", "голос"], ["вільна"], "20"],
  ["nochenka", "Ноченька", "Тіна Кароль", "ua", ["ніченька", "тиха", "серце", "голос", "самота"], ["ноченька", "ніченька"], "00"],
  ["shaleniy", "Шалений", "Дзідзьо", "ua", ["шалений", "світ", "танці", "село", "сміх"], ["шалений"], "10"],
  ["ya-i-sara", "Я і Сара", "Дзідзьо", "ua", ["я", "і", "сара", "дорога", "пригоди"], ["я і сара"], "10"],
  ["pavuk", "Павук", "Дзідзьо", "ua", ["павук", "куток", "страх", "сміх", "дім"], ["павук"], "10"],
  ["novogodnyaya", "Новорічна", "Дзідзьо", "ua", ["новий", "рік", "свято", "сніг", "хата"], ["новорічна"], "10"],
  ["imya-505", "Имя 505", "Время и Стекло", "ru", ["имя", "пять", "ноль", "пять", "танец"], ["имя 505"], "10"],
  ["pesnya-404", "Песня 404", "Время и Стекло", "ru", ["песня", "четыре", "ноль", "четыре", "поиск"], ["песня 404"], "10"],
  ["navernopotomuchto", "Навернопотомучто", "Время и Стекло", "ru", ["наверно", "потому", "что", "лето", "танцы"], ["навернопотомучто"], "10"],
  ["troll", "Тролль", "Время и Стекло", "ru", ["тролль", "чат", "ночь", "смех", "танцы"], ["тролль"], "10"],
  ["dim", "Дим", "Время и Стекло", "ru", ["дим", "город", "ночь", "свет", "окна"], ["дим"], "10"],
  ["vislovo", "Вислово", "Время и Стекло", "ua", ["ви", "слово", "сцена", "ритм", "руки"], ["вислово"], "20"],
  ["deep", "Deep", "MONATIK", "ua", ["deep", "танець", "ніч", "світло", "серце"], ["deep"], "10"],
  ["kruzhit", "Кружит", "MONATIK", "ru", ["кружит", "голова", "танец", "ночь", "город"], ["кружит"], "10"],
  ["vitamin-d", "Vitamin D", "MONATIK", "ua", ["вітамін", "сонце", "танці", "день", "любов"], ["vitamin d"], "10"],
  ["uvliuvt", "УВЛИУВТ", "MONATIK", "ru", ["увлиувт", "ритм", "свет", "ночь", "танцы"], ["увлиувт"], "10"],
  ["silno", "Сильно", "MONATIK", "ua", ["сильно", "серце", "биття", "музика", "ніч"], ["сильно"], "20"],
  ["krasivo", "Красиво", "MONATIK", "ru", ["красиво", "танец", "сцена", "свет", "любов"], ["красиво"], "20"],
  ["tuman", "Туманы", "Макс Барских", "ru", ["туманы", "город", "ночь", "окна", "сердце"], ["туманы"], "10"],
  ["podruga-noch", "Подруга-ночь", "Макс Барских", "ru", ["подруга", "ночь", "город", "огни", "танец"], ["подруга ночь"], "10"],
  ["sdelay-gromche", "Сделай громче", "Макс Барских", "ru", ["сделай", "громче", "музыка", "ночь", "клуб"], ["сделай громче"], "10"],
  ["berega", "Берега", "Макс Барских", "ru", ["берега", "море", "ночь", "любовь", "даль"], ["берега"], "10"],
  ["ley-ne-zhaley", "Лей, не жалей", "Макс Барских", "ru", ["лей", "не", "жалей", "ночь", "огни"], ["лей не жалей"], "20"],
  ["ritmy", "Ритмы", "Макс Барских", "ru", ["ритмы", "город", "ночь", "танцы", "свет"], ["ритмы"], "20"],
  ["malo-tebya", "Мало тебя", "LOBODA", "ru", ["мало", "тебя", "ночь", "сердце", "пусто"], ["мало тебя"], "10"],
  ["tvoyi-glaza", "Твои глаза", "LOBODA", "ru", ["твои", "глаза", "ночь", "свет", "магнит"], ["твои глаза"], "10"],
  ["sluchaynaya", "Случайная", "LOBODA", "ru", ["случайная", "ночь", "город", "любовь", "такси"], ["случайная"], "10"],
  ["superstar", "SuperSTAR", "LOBODA", "ru", ["superstar", "сцена", "свет", "танец", "ночь"], ["superstar"], "10"],
  ["moj", "Мой", "LOBODA", "ru", ["мой", "город", "ночь", "сердце", "огонь"], ["мой"], "20"],
  ["instadrama", "Instadrama", "LOBODA", "ru", ["instadrama", "экран", "лайки", "ночь", "слезы"], ["instadrama"], "20"],
  ["nebolno", "Небольно", "LOBODA", "ru", ["небольно", "сердце", "ночь", "тишина", "уход"], ["небольно"], "20"],
  ["shlepki", "Шлёпки", "Вера Брежнева", "ru", ["шлёпки", "лето", "пляж", "танцы", "солнце"], ["шлепки"], "00"],
  ["realnaya-zhizn", "Реальная жизнь", "Вера Брежнева", "ru", ["реальная", "жизнь", "любовь", "город", "свет"], ["реальная жизнь"], "00"],
  ["dobroe-utro", "Доброе утро", "Вера Брежнева", "ru", ["доброе", "утро", "солнце", "окна", "улыбка"], ["доброе утро"], "10"],
  ["popitka-nomer-pyat", "Попытка номер пять", "ВИА Гра", "ru", ["попытка", "номер", "пять", "сердце", "снова"], ["попытка номер пять"], "00"],
  ["ne-ostavlyay", "Не оставляй меня, любимый", "ВИА Гра", "ru", ["не", "оставляй", "меня", "любимый", "ночь"], ["не оставляй меня любимый"], "00"],
  ["biologiya", "Биология", "ВИА Гра", "ru", ["биология", "любовь", "тело", "ночь", "ритм"], ["биология"], "00"],
  ["brillianty", "Бриллианты", "ВИА Гра", "ru", ["бриллианты", "слезы", "ночь", "глаза", "свет"], ["бриллианты"], "00"],
  ["peremirie", "Перемирие", "ВИА Гра", "ru", ["перемирие", "любовь", "война", "ночь", "слова"], ["перемирие"], "10"],
  ["ya-ne-ponyal", "Я не понял", "Вера Сердючка", "ru", ["я", "не", "понял", "сцена", "смех"], ["я не понял"], "00"],
  ["dancing-lasha-tumbai", "Dancing Lasha Tumbai", "Вєрка Сердючка", "ua", ["dancing", "lasha", "tumbai", "сцена", "свято"], ["lasha tumbai"], "00"],
  ["gulyanochka", "Гуляночка", "Вєрка Сердючка", "ua", ["гуляночка", "свято", "танці", "ніч", "зал"], ["гуляночка"], "00"],
  ["vse-budet-horosho", "Все будет хорошо", "Вєрка Сердючка", "ru", ["все", "будет", "хорошо", "свет", "улыбка"], ["все будет хорошо"], "00"],
  ["i-am-not-alone", "Я не один", "KAZAKY", "ua", ["я", "не", "один", "сцена", "ритм"], ["я не один"], "10"],
  ["love-kazaky", "Love", "KAZAKY", "ua", ["love", "heels", "dance", "stage", "black"], ["love"], "10"],
  ["na-stile", "На стиле", "Грибы", "ru", ["на", "стиле", "танцы", "город", "дым"], ["на стиле"], "10"],
  ["taet-led", "Тает лёд", "Грибы", "ru", ["тает", "лёд", "между", "нами", "ночь"], ["тает лед"], "10"],
  ["kopi", "Копы", "Грибы", "ru", ["копы", "город", "ночь", "движ", "улица"], ["копы"], "10"],
  ["panda-e", "Панда", "Miyagi & Эндшпиль", "ru", ["панда", "дым", "дорога", "ночь", "район"], ["панда"], "10"],
  ["minor", "Minor", "Miyagi & Эндшпиль", "ru", ["minor", "ночь", "район", "звук", "сердце"], ["minor"], "10"],
  ["kosandra", "Kosandra", "Miyagi & Andy Panda", "ru", ["kosandra", "дым", "ночь", "танец", "район"], ["kosandra"], "20"],
  ["i-got-love", "I Got Love", "Miyagi & Эндшпиль", "ru", ["got", "love", "дым", "район", "ночь"], ["i got love"], "10"],
  ["colorit", "Колорит", "Miyagi & Эндшпиль", "ru", ["колорит", "улица", "ночь", "звук", "любовь"], ["колорит"], "10"],
  ["rozovoe-vino", "Розовое вино", "Элджей & Feduk", "ru", ["розовое", "вино", "закат", "вечер", "туса"], ["розовое вино"], "10"],
  ["minimal", "Минимал", "Элджей", "ru", ["минимал", "ночь", "стиль", "город", "бит"], ["минимал"], "10"],
  ["rvanaya-dusha", "Рваная душа", "Егор Крид", "ru", ["рваная", "душа", "ночь", "сердце", "боль"], ["рваная душа"], "10"],
  ["samaya-samaya", "Самая-самая", "Егор Крид", "ru", ["самая", "самая", "глаза", "город", "ночь"], ["самая самая"], "10"],
  ["budilnik", "Будильник", "Егор Крид", "ru", ["будильник", "утро", "сон", "любовь", "город"], ["будильник"], "10"],
  ["krutoy", "Крутой", "Егор Крид", "ru", ["крутой", "ночь", "сцена", "девочка", "бит"], ["крутой"], "20"],
  ["malo-polovin", "Мало половин", "Ольга Бузова", "ru", ["мало", "половин", "сердце", "ночь", "слезы"], ["мало половин"], "10"],
  ["million-alyh-roz", "Миллион алых роз", "Алла Пугачёва", "ru", ["миллион", "алых", "роз", "окно", "любовь"], ["миллион алых роз"], "00"],
  ["pozovi-menya", "Позови меня с собой", "Алла Пугачёва", "ru", ["позови", "меня", "с", "собой", "дождь"], ["позови меня с собой"], "00"],
  ["belie-rozy", "Белые розы", "Ласковый май", "ru", ["белые", "розы", "ночь", "зима", "окно"], ["белые розы"], "00"],
  ["sedaya-noch", "Седая ночь", "Юрий Шатунов", "ru", ["седая", "ночь", "окно", "звезды", "тишина"], ["седая ночь"], "00"],
  ["rozovye-rozy", "Розовые розы", "Весёлые ребята", "ru", ["розовые", "розы", "девочка", "свет", "вечер"], ["розовые розы"], "00"],
  ["vladivostok-2000", "Владивосток 2000", "Мумий Тролль", "ru", ["владивосток", "две", "тысячи", "город", "море"], ["владивосток 2000"], "00"],
  ["utekay", "Утекай", "Мумий Тролль", "ru", ["утекай", "ночь", "город", "море", "свет"], ["утекай"], "00"],
  ["medveditsa", "Медведица", "Мумий Тролль", "ru", ["медведица", "ночь", "звезды", "море", "любовь"], ["медведица"], "00"],
  ["nevestka", "Невеста", "Мумий Тролль", "ru", ["невеста", "цветы", "город", "ночь", "свадьба"], ["невеста"], "00"],
  ["zvezda-po-imeni-solnce", "Звезда по имени Солнце", "Кино", "ru", ["звезда", "по", "имени", "солнце", "небо"], ["звезда по имени солнце"], "00"],
  ["gruppa-krovi", "Группа крови", "Кино", "ru", ["группа", "крови", "рукав", "дорога", "ночь"], ["группа крови"], "00"],
  ["kukushka", "Кукушка", "Кино", "ru", ["кукушка", "сколько", "песен", "мне", "петь"], ["кукушка"], "00"],
  ["pachka-sigaret", "Пачка сигарет", "Кино", "ru", ["пачка", "сигарет", "самолет", "ночь", "дорога"], ["пачка сигарет"], "00"],
  ["vakhteram", "Вахтёрам", "Бумбокс", "ru", ["вахтерам", "ночь", "город", "двери", "любовь"], ["вахтерам", "вахтёрам"], "00"],
  ["ta4to", "Та4то", "Бумбокс", "ru", ["та", "что", "песня", "ночь", "город"], ["та4то", "та что"], "00"],
  ["eva", "Ева", "Винтаж", "ru", ["ева", "песня", "ночь", "дискотека", "свет"], ["ева"], "00"],
  ["plohaya-devochka", "Плохая девочка", "Винтаж", "ru", ["плохая", "девочка", "ночь", "клуб", "танцы"], ["плохая девочка"], "00"],
  ["odinokaya-luna", "Одинокая луна", "Винтаж", "ru", ["одинокая", "луна", "ночь", "окно", "город"], ["одинокая луна"], "00"],
  ["prosto-podari", "Просто подари", "Филипп Киркоров", "ru", ["просто", "подари", "мне", "один", "взгляд"], ["просто подари"], "00"],
  ["sneg", "Снег", "Филипп Киркоров", "ru", ["снег", "окна", "ночь", "любовь", "тишина"], ["снег"], "00"],
  ["zayka-moya", "Зайка моя", "Филипп Киркоров", "ru", ["зайка", "моя", "сцена", "свет", "улыбка"], ["зайка моя"], "00"],
  ["nas-ne-dogonyat", "Нас не догонят", "t.A.T.u.", "ru", ["нас", "не", "догонят", "ночь", "скорость"], ["нас не догонят"], "00"],
  ["ya-soshla-s-uma", "Я сошла с ума", "t.A.T.u.", "ru", ["я", "сошла", "с", "ума", "любовь"], ["я сошла с ума"], "00"],
  ["all-the-things", "All The Things She Said", "t.A.T.u.", "ru", ["all", "the", "things", "she", "said"], ["all the things she said"], "00"],
  ["kroshka-moya", "Крошка моя", "Руки Вверх!", "ru", ["крошка", "моя", "я", "по", "тебе"], ["крошка моя"], "00"],
  ["18-mne-uzhe", "18 мне уже", "Руки Вверх!", "ru", ["восемнадцать", "мне", "уже", "дискотека", "ночь"], ["18 мне уже"], "00"],
  ["student", "Студент", "Руки Вверх!", "ru", ["студент", "зима", "общага", "любовь", "дискотека"], ["студент"], "00"],
  ["on-tebya-tseluet", "Он тебя целует", "Руки Вверх!", "ru", ["он", "тебя", "целует", "ночь", "танцы"], ["он тебя целует"], "00"],
  ["nu-gde-zhe-vy-devchonki", "Ну где же вы, девчонки", "Руки Вверх!", "ru", ["где", "же", "вы", "девчонки", "вечер"], ["ну где же вы девчонки"], "00"],
  ["solnyshko", "Солнышко", "Demo", "ru", ["солнышко", "в", "руках", "лето", "танцы"], ["солнышко"], "00"],
  ["ya-ne-znayu", "Я не знаю", "Demo", "ru", ["я", "не", "знаю", "сердце", "дискотека"], ["я не знаю"], "00"],
  ["ruchki", "Ручки", "Вирус", "ru", ["ручки", "вверх", "дискотека", "ночь", "танцы"], ["ручки"], "00"],
  ["ty-menya-ne-ishchi", "Ты меня не ищи", "Вирус", "ru", ["ты", "меня", "не", "ищи", "ночь"], ["ты меня не ищи"], "00"],
  ["avariya", "Если хочешь остаться", "Дискотека Авария", "ru", ["если", "хочешь", "остаться", "ночь", "танцы"], ["если хочешь остаться"], "00"],
  ["nebo", "Небо", "Дискотека Авария", "ru", ["небо", "самолет", "ночь", "любовь", "дискотека"], ["небо"], "00"],
  ["malinki", "Малинки", "Дискотека Авария & Жанна Фриске", "ru", ["малинки", "девочки", "вечер", "танцы", "лето"], ["малинки"], "00"],
  ["noviy-god", "Новогодняя", "Дискотека Авария", "ru", ["новый", "год", "елка", "танцы", "снег"], ["новогодняя"], "00"],
  ["provence", "Прованс", "Ёлка", "ru", ["прованс", "самолет", "билет", "девочка", "мечта"], ["прованс"], "10"],
  ["na-bolshom-vozdushnom-share", "На большом воздушном шаре", "Ёлка", "ru", ["большом", "воздушном", "шаре", "небо", "мечта"], ["на большом воздушном шаре"], "10"],
  ["okolo-tebya", "Около тебя", "Ёлка", "ru", ["около", "тебя", "мир", "тише", "сердце"], ["около тебя"], "10"],
  ["greyu-schastye", "Грею счастье", "Ёлка", "ru", ["грею", "счастье", "руки", "дом", "зима"], ["грею счастье"], "10"],
  ["lyubov-morkov", "Любовь-морковь", "Quest Pistols", "ru", ["любовь", "морковь", "танцы", "сцена", "смех"], ["любовь морковь"], "00"],
  ["ya-ustal", "Я устал", "Quest Pistols", "ru", ["я", "устал", "хочу", "любви", "тишины"], ["я устал"], "00"],
  ["belye-strekozy", "Белые стрекозы любви", "Quest Pistols", "ru", ["белые", "стрекозы", "любви", "небо", "лето"], ["белые стрекозы любви"], "00"],
  ["mokra", "Мокра", "Quest Pistols Show", "ru", ["мокра", "ночь", "танец", "дождь", "клуб"], ["мокра"], "10"],
  ["santa-lucia", "Санта Лючия", "Quest Pistols Show", "ru", ["санта", "лючия", "море", "ночь", "танец"], ["санта лючия"], "10"],
  ["dymy", "Дымы", "MOT", "ru", ["дымы", "город", "ночь", "сердце", "такси"], ["дымы"], "10"],
  ["kapkan", "Капкан", "MOT", "ru", ["капкан", "любовь", "ночь", "сети", "сердце"], ["капкан"], "10"],
  ["den-i-noch", "День и ночь", "MOT", "ru", ["день", "и", "ночь", "город", "любовь"], ["день и ночь"], "10"],
  ["soprano", "Сопрано", "MOT feat. Ани Лорак", "ru", ["сопрано", "голос", "сердце", "ночь", "сцена"], ["сопрано"], "10"],
  ["mama-ya-v-dubae", "Мама, я в Дубае", "Jah Khalib", "ru", ["мама", "я", "в", "дубае", "ночь"], ["мама я в дубае"], "20"],
  ["leyla", "Лейла", "Jah Khalib", "ru", ["лейла", "ночь", "пустыня", "сердце", "восток"], ["лейла"], "10"],
  ["medina", "Медина", "Jah Khalib", "ru", ["медина", "ночь", "город", "сердце", "ритм"], ["медина"], "10"],
  ["esli-che-ya-baha", "Если че, я Баха", "Jah Khalib", "ru", ["если", "че", "я", "баха", "район"], ["если че я баха"], "10"],
  ["otpuskaem", "Отпускаем", "Макс Корж", "ru", ["отпускаем", "ночь", "дорога", "друзья", "город"], ["отпускаем"], "10"],
  ["malinoviy-zakat", "Малиновый закат", "Макс Корж", "ru", ["малиновый", "закат", "двор", "друзья", "вечер"], ["малиновый закат"], "10"],
  ["gory-po-koleno", "Горы по колено", "Макс Корж", "ru", ["горы", "по", "колено", "дорога", "свобода"], ["горы по колено"], "10"],
  ["zhit-v-kayf", "Жить в кайф", "Макс Корж", "ru", ["жить", "в", "кайф", "друзья", "двор"], ["жить в кайф"], "10"],
  ["plamennyy-svet", "Пламенный свет", "Макс Корж", "ru", ["пламенный", "свет", "ночь", "дорога", "мечта"], ["пламенный свет"], "20"],
  ["pokolenie", "Поколение", "Макс Корж", "ru", ["поколение", "улица", "друзья", "мечта", "свобода"], ["поколение"], "20"],
  ["crush", "Crush", "YAKTAK", "ua", ["crush", "серце", "ніч", "чат", "погляд"], ["crush"], "20"],
  ["pogled", "Погляд", "YAKTAK", "ua", ["погляд", "очі", "ніч", "місто", "серце"], ["погляд"], "20"],
  ["la-la-la-yaktak", "ЛаЛаЛа", "YAKTAK", "ua", ["ла", "ла", "ла", "ніч", "танці"], ["лалала"], "20"],
  ["nebo-yaktak", "Небо", "YAKTAK", "ua", ["небо", "руки", "серце", "дорога", "ти"], ["небо"], "20"],
  ["porichka", "Порічка", "YAKTAK & KOLA", "ua", ["порічка", "літо", "смак", "серце", "зустріч"], ["порічка"], "20"],
  ["teresa-mariya", "Teresa & Maria", "alyona alyona & Jerry Heil", "ua", ["teresa", "maria", "сила", "голос", "небо"], ["teresa maria"], "20"],
  ["okhrana-otmena", "Охрана отмєна", "alyona alyona", "ua", ["охрана", "отмєна", "сцена", "ритм", "слово"], ["охрана отмєна"], "10"],
  ["pushka", "Пушка", "alyona alyona", "ua", ["пушка", "слово", "біт", "сцена", "сила"], ["пушка"], "10"],
  ["ridni-moi", "Рідні мої", "alyona alyona", "ua", ["рідні", "мої", "дім", "серце", "слово"], ["рідні мої"], "20"],
  ["vechornytsi", "Вечорниці", "100лиця & SKYLERR", "ua", ["вечорниці", "ніч", "свято", "дівчата", "танці"], ["вечорниці"], "20"],
  ["dodomu-skofka", "Додому", "Kalush & Skofka", "ua", ["додому", "дорога", "мама", "місто", "серце"], ["додому"], "20"],
  ["oy-na-gori", "Ой на горі", "Kalush", "ua", ["ой", "на", "горі", "ніч", "трембіта"], ["ой на горі"], "20"],
  ["zori", "Зорі", "Kalush", "ua", ["зорі", "небо", "ніч", "голос", "дім"], ["зорі"], "20"],
  ["patron", "Патрон", "Kalush", "ua", ["патрон", "пес", "дім", "сміх", "друзі"], ["патрон"], "20"],
  ["home-kalush", "Home", "Kalush Orchestra", "ua", ["home", "дорога", "серце", "дім", "голос"], ["home"], "20"],
  ["zaproshu-na-kavu", "Запрошу на каву", "Jerry Heil", "ua", ["запрошу", "на", "каву", "ранок", "усмішка"], ["запрошу на каву"], "20"],
  ["mriya", "Мрія", "Jerry Heil", "ua", ["мрія", "небо", "голос", "крила", "світ"], ["мрія"], "20"],
  ["vegan", "Веган", "Jerry Heil", "ua", ["веган", "жарт", "кухня", "сміх", "пісня"], ["веган"], "20"],
  ["poshta", "Пошта", "Jerry Heil", "ua", ["пошта", "лист", "серце", "очікування", "ніч"], ["пошта"], "20"],
  ["nonsense", "Nonsense", "Jerry Heil", "ua", ["nonsense", "сцена", "ритм", "сміх", "голос"], ["nonsense"], "20"],
  ["a-ya-vse-plakala", "А я все плакала", "KAZKA", "ua", ["я", "все", "плакала", "ніч", "кухня"], ["а я все плакала"], "10"],
  ["svyata", "Свята", "KAZKA", "ua", ["свята", "вогні", "ніч", "місто", "серце"], ["свята"], "10"],
  ["palala", "Палала", "KAZKA", "ua", ["палала", "ніч", "вогонь", "серце", "танці"], ["палала"], "20"],
  ["pisnya-smilyvyh-divchat", "Пісня сміливих дівчат", "KAZKA", "ua", ["сміливих", "дівчат", "голос", "серце", "сила"], ["пісня сміливих дівчат"], "20"],
  ["kolyskova", "Колискова", "KAZKA", "ua", ["колискова", "ніч", "сон", "мама", "тиша"], ["колискова"], "20"],
  ["otaman", "Ой, у лузі червона калина", "The Kiffness & Andriy Khlyvnyuk", "ua", ["ой", "у", "лузі", "червона", "калина"], ["червона калина"], "20"],
  ["and-the-boys", "Ой, у лузі червона калина", "Бумбокс", "ua", ["у", "лузі", "червона", "калина", "пісня"], ["ой у лузі червона калина"], "20"],
  ["khreshchatyk", "Хрещатик", "Павло Зібров", "ua", ["хрещатик", "вечір", "київ", "вогні", "любов"], ["хрещатик"], "00"],
  ["smereka", "Смерека", "Микола Гнатюк", "ua", ["смерека", "гори", "вітер", "карпати", "пісня"], ["смерека"], "00"],
  ["hutsulka-ksenya", "Гуцулка Ксеня", "Traditional", "ua", ["гуцулка", "ксеня", "гори", "танці", "ніч"], ["гуцулка ксеня"], "00"],
  ["ty-zh-mene-pidmanula", "Ти ж мене підманула", "Traditional", "ua", ["ти", "ж", "мене", "підманула", "дівчина"], ["ти ж мене підманула"], "00"],
  ["nese-galya-vodu", "Несе Галя воду", "Traditional", "ua", ["несе", "галя", "воду", "дівчина", "стежка"], ["несе галя воду"], "00"],
  ["chervona-kalyna-trad", "Червона калина", "Traditional", "ua", ["червона", "калина", "луг", "сила", "пісня"], ["червона калина"], "00"]
];

songs.push(...extraCatalog.map(([id, title, artist, pack, phrase, aliases]) => song(id, title, artist, pack, [phrase], aliases)));
songs.push(...regionalCatalog.map(([id, title, artist, pack, phrase, aliases]) => song(id, title, artist, pack, [phrase], aliases)));
songs.push(...loadCustomSongs());

const nostalgiaIds = new Set(extraCatalog.filter((item) => item[6] === "nostalgia").map((item) => item[0]).concat([
  "barbie-girl", "dragostea", "toxic", "baby-one-more-time", "californication", "numb", "in-the-end", "crazy-in-love", "umbrella", "viva-la-vida", "lose-yourself", "gangnam-style", "waka-waka", "wonderwall", "billie-jean"
]));

refreshPresetSongIds();

function song(id, title, artist, pack, wordsOrPhrases, aliases = []) {
  const exact = exactPhrases[id];
  const phrases = normalizePhrases(exact || wordsOrPhrases);
  return { id, title, artist, pack, words: phrases[0], phrases, aliases, exact: Boolean(exact) };
}

function normalizePhrases(wordsOrPhrases) {
  if (!Array.isArray(wordsOrPhrases)) return [["music", "party", "song", "voice", "stage"]];
  const first = wordsOrPhrases[0];
  if (Array.isArray(first)) {
    return wordsOrPhrases.map((phrase) => phrase.map(String).filter(Boolean).slice(0, 5)).filter((phrase) => phrase.length === 5);
  }
  const words = wordsOrPhrases.map(String).filter(Boolean);
  const phrases = [];
  for (let index = 0; index + 4 < words.length; index += 5) phrases.push(words.slice(index, index + 5));
  if (!phrases.length && words.length >= 5) phrases.push(words.slice(0, 5));
  return phrases.length ? phrases : [["music", "party", "song", "voice", "stage"]];
}

function pickPhrase(sourceSong) {
  const phrase = shuffle(sourceSong.phrases || [sourceSong.words || []])[0] || [];
  return phrase.slice(0, 5);
}

function loadCustomSongs() {
  const filePath = path.join(root, "custom-songs.json");
  if (!fs.existsSync(filePath)) return [];
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(payload)) return [];
    return payload
      .map((item, index) => {
        const customSong = song(
          cleanId(item.id || `custom-${index + 1}`),
          clean(item.title),
          clean(item.artist) || "Custom",
          ["ua", "ru", "global"].includes(item.pack) ? item.pack : "global",
          item.phrases || item.words || [],
          Array.isArray(item.aliases) ? item.aliases : []
        );
        customSong.exact = customSong.phrases.length > 0;
        customSong.era = clean(item.era) || (customSong.pack === "ua" ? "20" : "");
        return customSong;
      })
      .filter((item) => item.title);
  } catch (error) {
    console.warn(`Could not load custom-songs.json: ${error.message}`);
    return [];
  }
}

function refreshPresetSongIds() {
  const party = presets.find((item) => item.id === "party");
  const ua = presets.find((item) => item.id === "ua");
  const ru = presets.find((item) => item.id === "ru");
  const regional = presets.find((item) => item.id === "regional");
  const hits00 = presets.find((item) => item.id === "hits-00");
  const hits10 = presets.find((item) => item.id === "hits-10");
  const hits20 = presets.find((item) => item.id === "hits-20");
  const global = presets.find((item) => item.id === "global");
  const nostalgia = presets.find((item) => item.id === "nostalgia");
  const regionalEraIds = (era) => new Set(regionalCatalog.filter((item) => item[6] === era).map((item) => item[0]));
  const isEra = (item, era) => item.era === era || regionalEraIds(era).has(item.id);
  const playable = songs.filter((item) => item.exact);
  if (party) party.songIds = playable.filter((item) => ["global", "ua", "ru"].includes(item.pack)).slice(0, 340).map((item) => item.id);
  if (ua) ua.songIds = playable.filter((item) => item.pack === "ua").map((item) => item.id);
  if (ru) ru.songIds = playable.filter((item) => item.pack === "ru").map((item) => item.id);
  if (regional) regional.songIds = playable.filter((item) => ["ua", "ru"].includes(item.pack)).map((item) => item.id);
  if (hits00) hits00.songIds = playable.filter((item) => isEra(item, "00")).map((item) => item.id);
  if (hits10) hits10.songIds = playable.filter((item) => isEra(item, "10")).map((item) => item.id);
  if (hits20) hits20.songIds = playable.filter((item) => isEra(item, "20")).map((item) => item.id);
  if (global) global.songIds = playable.filter((item) => item.pack === "global").map((item) => item.id);
  if (nostalgia) nostalgia.songIds = playable.filter((item) => item.pack === "global" && nostalgiaIds.has(item.id)).map((item) => item.id);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  for (let i = 0; i < 5; i += 1) value += alphabet[Math.floor(Math.random() * alphabet.length)];
  return rooms.has(value) ? code() : value;
}

function token() {
  return crypto.randomBytes(18).toString("hex");
}

function publicRoom(room, requester = {}) {
  const viewerTeam = actorTeam(room, requester);
  const isHost = requester.hostToken === room.hostToken;
  const result = room.current?.result || null;
  return {
    code: room.code,
    isHost,
    viewerTeam,
    canPlay: room.stage === "playing" && viewerTeam === room.activeTeam,
    canAdvance: room.stage === "result" && (isHost || viewerTeam === oppositeTeam(room.activeTeam)),
    canSteal: room.stage === "result" && result && !result.won && !result.correctedBy && viewerTeam === oppositeTeam(result.team),
    stage: room.stage,
    preset: room.preset,
    rounds: room.rounds,
    roundIndex: room.roundIndex,
    activeTeam: room.activeTeam,
    teams: room.teams,
    players: room.players,
    current: room.current ? {
      words: room.current.words.map((word, index) => room.current.revealed[index] || room.stage === "result" || room.stage === "final" ? word : null),
      revealed: room.current.revealed,
      points: availablePoints(room),
      result: room.current.result,
      preview: room.stage === "result" || room.stage === "final" ? room.current.preview || null : null,
      song: room.stage === "result" || room.stage === "final" ? safeSong(room.current.song) : null
    } : null,
    updatedAt: room.updatedAt
  };
}

function safeSong(source) {
  return { id: source.id, title: source.title, artist: source.artist };
}

function songPool(presetId) {
  const playableSongs = songs.filter((item) => item.exact && item.phrases?.length);
  if (presetId === "all") return playableSongs;
  const preset = presets.find((item) => item.id === presetId) || presets[0];
  const ids = new Set(preset.songIds);
  const pool = playableSongs.filter((item) => ids.has(item.id));
  return pool.length ? pool : playableSongs;
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildDeck(presetId, rounds) {
  const pool = songPool(presetId);
  if (!pool.length) throw new Error("No playable songs with exact phrases");
  const deck = [];
  while (deck.length < rounds) deck.push(...shuffle(pool));
  return deck.slice(0, rounds);
}

function createRoom(body) {
  const roomCode = code();
  const hostToken = token();
  const preset = presets.some((item) => item.id === body.preset) ? body.preset : "party";
  const rounds = clamp(Number(body.rounds) || 12, 1, 60);
  const hostTeam = body.hostTeam === "boys" ? "boys" : "girls";
  const hostName = clean(body.hostName) || "Ведучий";
  const room = {
    code: roomCode,
    hostToken,
    stage: "lobby",
    preset,
    rounds,
    roundIndex: 0,
    activeTeam: hostTeam,
    teams: {
      girls: { name: clean(body.girlsName) || "Дівчата", score: 0 },
      boys: { name: clean(body.boysName) || "Хлопці", score: 0 }
    },
    players: [{
      id: `host-${hostToken.slice(0, 10)}`,
      name: hostName,
      team: hostTeam,
      host: true,
      joinedAt: Date.now()
    }],
    deck: buildDeck(preset, rounds),
    current: null,
    updatedAt: Date.now()
  };
  rooms.set(roomCode, room);
  return { room, hostToken };
}

function startRound(room) {
  if (room.roundIndex >= room.rounds) {
    room.stage = "final";
    room.updatedAt = Date.now();
    return;
  }
  const currentSong = room.deck[room.roundIndex];
  room.roundIndex += 1;
  room.current = {
    song: currentSong,
    words: pickPhrase(currentSong),
    revealed: [false, false, false, false, false],
    result: null,
    preview: null
  };
  prewarmCurrentPreview(room);
  room.stage = "playing";
  room.updatedAt = Date.now();
}

function prewarmCurrentPreview(room) {
  const current = room.current;
  if (!current?.song) return;
  findPreview(current.song.title, current.song.artist).then((preview) => {
    if (room.current === current) {
      current.preview = preview;
      room.updatedAt = Date.now();
    }
  }).catch(() => {});
}

function actorTeam(room, body) {
  if (body?.playerId) {
    const player = room.players.find((item) => item.id === body.playerId);
    if (player?.team) return player.team;
  }
  if (body?.hostToken === room.hostToken) {
    const host = room.players.find((item) => item.host);
    if (host?.team) return host.team;
  }
  return null;
}

function hiddenWords(room) {
  if (!room.current) return [];
  return room.current.words.filter((word, index) => !room.current.revealed[index]);
}

function expectedAnswer(room) {
  const hidden = hiddenWords(room);
  return (hidden.length ? hidden : room.current?.words || []).join(" ");
}

function reveal(room, index, team = room.activeTeam) {
  if (room.stage !== "playing" || !room.current) return;
  const safeIndex = Number(index);
  if (Number.isInteger(safeIndex) && safeIndex >= 0 && safeIndex < 5) room.current.revealed[safeIndex] = true;
  if (room.current.revealed.every(Boolean)) {
    resolveGuess(room, "", false, team);
    return;
  }
  room.updatedAt = Date.now();
}

function revealRandom(room, team = room.activeTeam) {
  if (room.stage !== "playing" || !room.current) return;
  const closed = room.current.revealed.map((isOpen, index) => isOpen ? null : index).filter((item) => item !== null);
  if (!closed.length) return;
  reveal(room, closed[Math.floor(Math.random() * closed.length)], team);
}

function resolveGuess(room, rawGuess, forcedWon = null, team = room.activeTeam) {
  if (room.stage !== "playing" || !room.current) return;
  const guess = clean(rawGuess);
  const anyOpen = room.current.revealed.some(Boolean);
  if (!anyOpen) return;
  const answer = expectedAnswer(room);
  const won = forcedWon === null ? matchesHiddenWords(guess, room) : Boolean(forcedWon);
  const points = won ? availablePoints(room) : 0;
  if (won && room.teams[team]) room.teams[team].score += points;
  room.current.result = {
    won,
    points,
    guess,
    answer,
    team,
    opened: room.current.revealed.filter(Boolean).length,
    at: Date.now()
  };
  room.stage = "result";
  room.updatedAt = Date.now();
}

function availablePoints(room) {
  if (!room.current) return 0;
  return Math.max(0, 5 - room.current.revealed.filter(Boolean).length);
}

function nextRound(room) {
  room.activeTeam = room.activeTeam === "girls" ? "boys" : "girls";
  startRound(room);
}

function oppositeTeam(team) {
  return team === "girls" ? "boys" : "girls";
}

function matchesHiddenWords(guess, room) {
  const normalizedGuess = normalize(guess);
  if (!normalizedGuess) return false;
  const normalizedAnswer = normalize(hiddenWords(room).join(" "));
  return Boolean(normalizedAnswer && normalizedGuess === normalizedAnswer);
}

function matchesSong(guess, currentSong) {
  const normalizedGuess = normalize(guess);
  if (!normalizedGuess) return false;
  const candidates = [currentSong.title, ...currentSong.aliases].map(normalize);
  return candidates.some((candidate) => normalizedGuess === candidate || candidate.includes(normalizedGuess) || normalizedGuess.includes(candidate));
}

function normalize(value) {
  return String(value || "")
    .toLocaleLowerCase("uk-UA")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['ʼ’`"«»„“”.,!?():;[\]{}\-_/\\|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

function cleanId(value) {
  return normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `song-${Date.now()}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function assertHost(room, body) {
  if (!body || body.hostToken !== room.hostToken) {
    const error = new Error("Host token required");
    error.statusCode = 403;
    throw error;
  }
}

function assertActiveTeam(room, body) {
  const team = actorTeam(room, body);
  if (!team || team !== room.activeTeam) {
    const error = new Error("Зараз хід іншої команди");
    error.statusCode = 403;
    throw error;
  }
  return team;
}

function assertCanAdvance(room, body) {
  if (body?.hostToken === room.hostToken) return;
  const team = actorTeam(room, body);
  if (room.stage === "result" && team === oppositeTeam(room.activeTeam)) return;
  const error = new Error("Наступний раунд запускає ведучий або наступна команда");
  error.statusCode = 403;
  throw error;
}

function stealSong(room, body) {
  if (room.stage !== "result" || !room.current?.result) return;
  const team = actorTeam(room, body);
  const result = room.current.result;
  if (!team || team !== oppositeTeam(result.team) || result.won || result.correctedBy) {
    const error = new Error("Зарахувати може тільки протилежна команда після помилкового провалу");
    error.statusCode = 403;
    throw error;
  }
  const points = Math.max(0, 5 - (result.opened || 0));
  if (room.teams[result.team]) room.teams[result.team].score += points;
  result.won = true;
  result.points = points;
  result.correctedBy = team;
  result.correctedAt = Date.now();
  result.at = Date.now();
  room.updatedAt = Date.now();
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      uptime: Math.round(process.uptime()),
      rooms: rooms.size,
      songs: songs.filter((item) => item.exact).length
    });
  }

  if (req.method === "GET" && url.pathname === "/api/presets") {
    return sendJson(res, 200, {
      presets: presets.map((preset) => ({
        ...preset,
        count: preset.id === "all" ? songs.filter((item) => item.exact).length : preset.songIds.length
      })),
      songs: songs.map(safeSong)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/meta") {
    return sendJson(res, 200, { publicUrl: getPublicUrl() });
  }

  if (req.method === "GET" && url.pathname === "/api/preview") {
    return sendJson(res, 200, await findPreview(url.searchParams.get("title"), url.searchParams.get("artist")));
  }

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readBody(req);
    const { room, hostToken } = createRoom(body);
    return sendJson(res, 200, { code: room.code, hostToken, room: publicRoom(room, { hostToken }) });
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{5})(?:\/([a-z-]+))?$/i);
  if (!roomMatch) return sendJson(res, 404, { error: "Not found" });

  const room = rooms.get(roomMatch[1].toUpperCase());
  if (!room) return sendJson(res, 404, { error: "Room not found" });
  const action = roomMatch[2];

  if (req.method === "GET" && !action) {
    return sendJson(res, 200, publicRoom(room, {
      hostToken: url.searchParams.get("hostToken"),
      playerId: url.searchParams.get("playerId")
    }));
  }

  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const body = await readBody(req);

  if (action === "join") {
    const player = {
      id: token().slice(0, 12),
      name: clean(body.name) || "Гравець",
      team: body.team === "boys" ? "boys" : "girls",
      joinedAt: Date.now()
    };
    room.players.push(player);
    room.updatedAt = Date.now();
    return sendJson(res, 200, { playerId: player.id, room: publicRoom(room, { playerId: player.id }) });
  }

  if (action !== "action") return sendJson(res, 404, { error: "Unknown action" });

  switch (body.type) {
    case "start":
      assertHost(room, body);
      room.teams.girls.name = clean(body.girlsName) || room.teams.girls.name;
      room.teams.boys.name = clean(body.boysName) || room.teams.boys.name;
      room.rounds = clamp(Number(body.rounds) || room.rounds, 1, 60);
      room.preset = presets.some((item) => item.id === body.preset) ? body.preset : room.preset;
      room.deck = buildDeck(room.preset, room.rounds);
      room.roundIndex = 0;
      room.activeTeam = room.players.find((player) => player.host)?.team || "girls";
      room.teams.girls.score = 0;
      room.teams.boys.score = 0;
      startRound(room);
      break;
    case "open":
      reveal(room, body.index, assertActiveTeam(room, body));
      break;
    case "openRandom":
      revealRandom(room, assertActiveTeam(room, body));
      break;
    case "guess":
      resolveGuess(room, body.guess, null, assertActiveTeam(room, body));
      break;
    case "forceCorrect":
      assertHost(room, body);
      resolveGuess(room, body.guess || expectedAnswer(room), true, room.activeTeam);
      break;
    case "forceWrong":
      assertHost(room, body);
      resolveGuess(room, body.guess || "", false, room.activeTeam);
      break;
    case "stealSong":
      stealSong(room, body);
      break;
    case "next":
      assertCanAdvance(room, body);
      nextRound(room);
      break;
    case "finish":
      assertHost(room, body);
      room.stage = "final";
      room.updatedAt = Date.now();
      break;
    case "lobby":
      assertHost(room, body);
      room.stage = "lobby";
      room.updatedAt = Date.now();
      break;
    default:
      return sendJson(res, 400, { error: "Unknown action" });
  }

  if ((room.stage === "result" || room.stage === "final") && room.current?.song && !room.current.preview) {
    room.current.preview = await findPreview(room.current.song.title, room.current.song.artist);
  }

  return sendJson(res, 200, { room: publicRoom(room, body) });
}

async function findPreview(title, artist) {
  const safeTitle = clean(title);
  const safeArtist = clean(artist);
  if (!safeTitle) return { previewUrl: null, trackViewUrl: null };
  const cacheKey = `${safeTitle}::${safeArtist}`.toLowerCase();
  if (previewCache.has(cacheKey)) return previewCache.get(cacheKey);
  const term = encodeURIComponent(`${safeTitle} ${safeArtist}`);
  const apiUrl = `https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=15`;
  try {
    const response = await fetch(apiUrl);
    const payload = await response.json();
    const results = Array.isArray(payload.results) ? payload.results : [];
    const wantedTitle = normalize(safeTitle);
    const wantedArtist = normalize(safeArtist).split(" feat ")[0].split(" & ")[0].trim();
    const ranked = results
      .filter((item) => item.previewUrl)
      .map((item) => {
        const track = normalize(item.trackName);
        const foundArtist = normalize(item.artistName);
        let score = 0;
        const artistMatches = wantedArtist && (foundArtist.includes(wantedArtist) || wantedArtist.includes(foundArtist));
        if (track === wantedTitle) score += 70;
        if (track.includes(wantedTitle) || wantedTitle.includes(track)) score += 45;
        if (artistMatches) score += 65;
        else if (wantedArtist) score -= 45;
        if (item.primaryGenreName === "Pop") score += 4;
        return { item, score };
      })
      .sort((a, b) => b.score - a.score)[0]?.item || results.find((item) => item.previewUrl) || results[0];
    const result = ranked ? {
      previewUrl: ranked.previewUrl || null,
      trackViewUrl: ranked.trackViewUrl || null,
      matchedTitle: ranked.trackName || null,
      matchedArtist: ranked.artistName || null,
      source: "itunes"
    } : {
      previewUrl: null,
      trackViewUrl: null,
      matchedTitle: null,
      matchedArtist: null,
      source: null
    };
    const finalResult = result.previewUrl ? result : await findDeezerPreview(safeTitle, safeArtist);
    previewCache.set(cacheKey, finalResult);
    return finalResult;
  } catch {
    return findDeezerPreview(safeTitle, safeArtist);
  }
}

async function findDeezerPreview(title, artist) {
  const term = encodeURIComponent(`${title} ${artist}`);
  const apiUrl = `https://api.deezer.com/search?q=${term}&limit=15`;
  try {
    const response = await fetch(apiUrl);
    const payload = await response.json();
    const results = Array.isArray(payload.data) ? payload.data : [];
    const wantedTitle = normalize(title);
    const wantedArtist = normalize(artist).split(" feat ")[0].split(" & ")[0].trim();
    const ranked = results
      .filter((item) => item.preview)
      .map((item) => {
        const track = normalize(item.title_short || item.title);
        const foundArtist = normalize(item.artist?.name);
        let score = 0;
        const artistMatches = wantedArtist && (foundArtist.includes(wantedArtist) || wantedArtist.includes(foundArtist));
        if (track === wantedTitle) score += 70;
        if (track.includes(wantedTitle) || wantedTitle.includes(track)) score += 45;
        if (artistMatches) score += 65;
        else if (wantedArtist) score -= 45;
        score += Math.min(10, Math.floor((item.rank || 0) / 100000));
        return { item, score };
      })
      .sort((a, b) => b.score - a.score)[0]?.item || results.find((item) => item.preview);
    return ranked ? {
      previewUrl: ranked.preview || null,
      trackViewUrl: ranked.link || null,
      matchedTitle: ranked.title_short || ranked.title || null,
      matchedArtist: ranked.artist?.name || null,
      source: "deezer"
    } : {
      previewUrl: null,
      trackViewUrl: null,
      matchedTitle: null,
      matchedArtist: null,
      source: null
    };
  } catch {
    return {
      previewUrl: null,
      trackViewUrl: null,
      matchedTitle: null,
      matchedArtist: null,
      source: null
    };
  }
}

function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, pathname));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(root, "index.html"), (fallbackError, fallbackData) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end("Not found");
        } else {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(fallbackData);
        }
      });
      return;
    }
    res.writeHead(200, { "content-type": contentType(filePath) });
    res.end(data);
  });
}

function getPublicUrl() {
  return clean(process.env.PUBLIC_URL || "");
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { ok: true });
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || "Server error" });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`5 words game is running on http://127.0.0.1:${port}`);
});
