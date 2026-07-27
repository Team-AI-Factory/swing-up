export type GlobalYahooMapping = {
  symbol: string;
  reason: string;
};

export type GlobalListingIdentity = {
  symbol: string;
  exchange: string;
  country?: string | null;
};

export function mapGlobalListingToYahoo(listing: GlobalListingIdentity): GlobalYahooMapping | null {
  const exchange = listing.exchange.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const symbol = listing.symbol.toUpperCase();
  const country = (listing.country ?? "").toLowerCase();
  const direct = () => symbol.replace(/\.([A-Z])$/, "-$1");

  if (["NASDAQ", "NYSE", "AMEX", "NYSEARCA", "BATS", "CBOE", "OTC", "OTCQX", "OTCQB"].includes(exchange)) return { symbol: direct(), reason: "US primary listing" };
  if (["LSE", "LSIN"].includes(exchange)) return { symbol: `${symbol}.L`, reason: "London Stock Exchange" };
  if (["TSE", "JPX"].includes(exchange)) return { symbol: `${symbol}.T`, reason: "Tokyo Stock Exchange" };
  if (exchange === "HKEX") return { symbol: `${symbol.padStart(4, "0")}.HK`, reason: "Hong Kong Exchange" };
  if (exchange === "NSE") return { symbol: `${symbol}.NS`, reason: "National Stock Exchange of India" };
  if (exchange === "BSE") return { symbol: `${symbol}.BO`, reason: "Bombay Stock Exchange" };
  if (exchange === "ASX") return { symbol: `${symbol}.AX`, reason: "Australian Securities Exchange" };
  if (exchange === "TSX") return { symbol: `${symbol}.TO`, reason: "Toronto Stock Exchange" };
  if (["TSXV", "TSXVENTURE"].includes(exchange)) return { symbol: `${symbol}.V`, reason: "TSX Venture" };
  if (exchange === "NEO") return { symbol: `${symbol}.NE`, reason: "Cboe Canada" };
  if (["XETR", "TRADEGATE"].includes(exchange)) return { symbol: `${symbol}.DE`, reason: "German electronic primary listing" };
  if (exchange === "FWB") return { symbol: `${symbol}.F`, reason: "Frankfurt Stock Exchange" };
  if (exchange === "MIL") return { symbol: `${symbol}.MI`, reason: "Borsa Italiana" };
  if (["BME", "BMAD"].includes(exchange)) return { symbol: `${symbol}.MC`, reason: "Madrid Stock Exchange" };
  if (exchange === "SIX") return { symbol: `${symbol}.SW`, reason: "SIX Swiss Exchange" };
  if (exchange === "VIE") return { symbol: `${symbol}.VI`, reason: "Vienna Stock Exchange" };
  if (["OMXSTO", "NGM"].includes(exchange)) return { symbol: `${symbol}.ST`, reason: "Sweden" };
  if (exchange === "OMXCOP") return { symbol: `${symbol}.CO`, reason: "Copenhagen" };
  if (exchange === "OMXHEL") return { symbol: `${symbol}.HE`, reason: "Helsinki" };
  if (exchange === "OSL") return { symbol: `${symbol}.OL`, reason: "Oslo" };
  if (exchange === "WSE") return { symbol: `${symbol}.WA`, reason: "Warsaw" };
  if (exchange === "PSE" && (country.includes("czech") || country.includes("czechia"))) return { symbol: `${symbol}.PR`, reason: "Prague Stock Exchange" };
  if (exchange === "BET") return { symbol: `${symbol}.RO`, reason: "Bucharest" };
  if (exchange === "ATHEX") return { symbol: `${symbol}.AT`, reason: "Athens" };
  if (exchange === "BIST") return { symbol: `${symbol}.IS`, reason: "Borsa Istanbul" };
  if (exchange === "TASE") return { symbol: `${symbol}.TA`, reason: "Tel Aviv" };
  if (exchange === "KRX") return { symbol: `${symbol.padStart(6, "0")}.KS`, reason: "Korea Exchange" };
  if (exchange === "KOSDAQ") return { symbol: `${symbol.padStart(6, "0")}.KQ`, reason: "KOSDAQ" };
  if (exchange === "TWSE") return { symbol: `${symbol}.TW`, reason: "Taiwan Stock Exchange" };
  if (exchange === "TPEX") return { symbol: `${symbol}.TWO`, reason: "Taipei Exchange" };
  if (exchange === "SSE") return { symbol: `${symbol}.SS`, reason: "Shanghai Stock Exchange" };
  if (exchange === "SZSE") return { symbol: `${symbol}.SZ`, reason: "Shenzhen Stock Exchange" };
  if (exchange === "SGX") return { symbol: `${symbol}.SI`, reason: "Singapore Exchange" };
  if (["MYX", "BURSA"].includes(exchange)) return { symbol: `${symbol}.KL`, reason: "Bursa Malaysia" };
  if (exchange === "IDX") return { symbol: `${symbol}.JK`, reason: "Indonesia Stock Exchange" };
  if (exchange === "SET") return { symbol: `${symbol}.BK`, reason: "Stock Exchange of Thailand" };
  if (exchange === "PSE" && country.includes("philipp")) return { symbol: `${symbol}.PS`, reason: "Philippine Stock Exchange" };
  if (exchange === "NZX") return { symbol: `${symbol}.NZ`, reason: "New Zealand Exchange" };
  if (exchange === "JSE") return { symbol: `${symbol}.JO`, reason: "Johannesburg Stock Exchange" };
  if (["BMFBOVESPA", "B3"].includes(exchange)) return { symbol: `${symbol}.SA`, reason: "B3 Brazil" };
  if (exchange === "BMV") return { symbol: `${symbol}.MX`, reason: "Mexican Stock Exchange" };
  if (exchange === "BYMA") return { symbol: `${symbol}.BA`, reason: "Buenos Aires" };
  if (exchange === "BCS") return { symbol: `${symbol}.SN`, reason: "Santiago" };
  if (exchange === "TADAWUL") return { symbol: `${symbol}.SR`, reason: "Saudi Exchange" };
  if (exchange === "QSE") return { symbol: `${symbol}.QA`, reason: "Qatar Stock Exchange" };
  if (exchange === "KSE") return { symbol: `${symbol}.KW`, reason: "Kuwait" };
  if (exchange === "EURONEXT") {
    if (country.includes("france")) return { symbol: `${symbol}.PA`, reason: "Euronext Paris" };
    if (country.includes("netherlands")) return { symbol: `${symbol}.AS`, reason: "Euronext Amsterdam" };
    if (country.includes("belgium")) return { symbol: `${symbol}.BR`, reason: "Euronext Brussels" };
    if (country.includes("portugal")) return { symbol: `${symbol}.LS`, reason: "Euronext Lisbon" };
    if (country.includes("ireland")) return { symbol: `${symbol}.IR`, reason: "Euronext Dublin" };
  }
  return null;
}
