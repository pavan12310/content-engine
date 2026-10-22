// lang.js - language-aware text measurement for the checks. Japanese and Chinese don't separate words with spaces,
// so their "words" are estimated from characters (about two characters per word); sentences also end with 。！？.
// Filler phrases and readability limits differ by language.
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/g;   // Japanese kana and Chinese/Japanese characters (Korean uses spaces)
export const cjkShare = t => { const s = String(t || "").replace(/\s+/g, ""); if (!s) return 0; return ((s.match(CJK) || []).length) / s.length; };
export const isCJK = t => cjkShare(t) > 0.25;

// approximate word count that works for every script
export function countWords(t) {
  const s = String(t || "");
  const cjk = (s.match(CJK) || []).length, rest = s.replace(CJK, " ");
  return (rest.match(/[A-Za-z0-9\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f\uac00-\ud7af'’]+/g) || []).length + Math.round(cjk / 2);
}
// a word list of the right length (for checks that count words)
export function wordList(t) {
  const s = String(t || ""), out = (s.replace(CJK, " ").match(/[A-Za-z0-9\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0900-\u097f\u0e00-\u0e7f\uac00-\ud7af'’]+/g) || []);
  const cjk = s.match(CJK) || []; for (let i = 0; i < cjk.length; i += 2) out.push(cjk.slice(i, i + 2).join(""));
  return out;
}
export const sentences = t => String(t || "").split(/(?<=[.!?])\s+|(?<=[。！？])\s*|\n+/).map(x => x.trim()).filter(Boolean);

// the language of a text: script first, then common words for Latin-script languages
const STOP = {
  en: ["the", "and", "is", "to", "of", "for", "with", "that", "your", "you", "this", "are"],
  es: ["el", "la", "los", "las", "de", "que", "y", "en", "para", "con", "una", "es", "por", "del"],
  pt: ["o", "os", "as", "de", "que", "e", "em", "para", "com", "uma", "não", "do", "da", "você"],
  fr: ["le", "la", "les", "des", "et", "est", "pour", "avec", "une", "que", "dans", "vous", "du"],
  de: ["der", "die", "das", "und", "ist", "für", "mit", "ein", "eine", "nicht", "sie", "zu", "den"],
  it: ["il", "la", "di", "che", "e", "per", "con", "una", "non", "del", "della", "sono", "gli"],
  nl: ["de", "het", "een", "en", "van", "voor", "met", "dat", "niet", "zijn", "je", "op", "te"],
};
export function detectLang(t) {
  const s = String(t || "").slice(0, 20000);
  if ((s.match(/[\u3040-\u30ff]/g) || []).length > 20) return "ja";
  if (isCJK(s)) return "zh";
  if ((s.match(/[\uac00-\ud7af]/g) || []).length > 40) return "ko";
  if ((s.match(/[\u0900-\u097f]/g) || []).length > 40) return "hi";
  if ((s.match(/[\u0600-\u06ff]/g) || []).length > 40) return "ar";
  if ((s.match(/[\u0400-\u04ff]/g) || []).length > 40) return "ru";
  const w = (s.toLowerCase().match(/[a-zà-ÿ]+/g) || []).slice(0, 3000), score = {};
  for (const [l, list] of Object.entries(STOP)) { const set = new Set(list); score[l] = w.filter(x => set.has(x)).length; }
  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 5 ? best[0] : "en";
}
// AI-style filler phrases in several languages (English ones are always checked too, since they leak into other languages)
export const FILLERS = {
  es: ["en el mundo actual", "en la era digital", "en el panorama actual", "sin lugar a dudas", "es importante destacar que", "cabe destacar que", "en conclusión", "no es ningún secreto", "sumérgete", "en el vertiginoso mundo"],
  pt: ["no mundo atual", "na era digital", "no cenário atual", "é importante ressaltar que", "vale destacar que", "sem dúvida alguma", "em conclusão", "mergulhe", "não é segredo que"],
  fr: ["dans le monde d'aujourd'hui", "à l'ère du numérique", "dans le paysage actuel", "il est important de noter que", "en conclusion", "sans aucun doute", "plongeons", "il n'est un secret pour personne"],
  de: ["in der heutigen schnelllebigen welt", "im digitalen zeitalter", "in der heutigen zeit", "es ist wichtig zu beachten", "zusammenfassend lässt sich sagen", "ohne zweifel", "tauchen wir ein"],
  it: ["nel mondo di oggi", "nell'era digitale", "nel panorama attuale", "è importante notare che", "in conclusione", "senza dubbio", "immergiamoci", "non è un segreto che"],
  nl: ["in de huidige snelle wereld", "in het digitale tijdperk", "het is belangrijk op te merken", "concluderend", "zonder twijfel", "laten we erin duiken"],
  ja: ["いかがでしたか", "ぜひ参考にしてください", "今日のデジタル時代", "言うまでもなく", "結論として", "注目を集めています", "様々なメリット", "まとめると"],
  zh: ["在当今快节奏的世界", "在数字时代", "众所周知", "总而言之", "毋庸置疑", "值得注意的是"],
  hi: ["आज की तेज़-तर्रार दुनिया में", "डिजिटल युग में", "यह ध्यान रखना महत्वपूर्ण है", "निष्कर्ष में", "इसमें कोई संदेह नहीं"],
};
// average words per sentence above which text gets hard to read (Japanese/Chinese counted as ~2 characters per word)
export const READABILITY = { default: 24, de: 22, ja: 35, zh: 35 };
export const readabilityLimit = lang => READABILITY[lang] || READABILITY.default;
// languages offered for localised versions (BCP-47 codes, used for hreflang)
export const LANGS = { en: "English", es: "Spanish", pt: "Portuguese", fr: "French", de: "German", it: "Italian", nl: "Dutch", ja: "Japanese", zh: "Chinese (Simplified)",
  ko: "Korean", hi: "Hindi", ar: "Arabic", ru: "Russian", pl: "Polish", tr: "Turkish", id: "Indonesian", sv: "Swedish", da: "Danish", no: "Norwegian", fi: "Finnish" };
