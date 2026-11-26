// Symbol lists for the Air Gap scanner. Index membership changes a few times a year and these lists are typed in by
// hand, so they are close but not exact: a ticker that no longer trades is simply skipped by the scan.

export const NASDAQ_100 = [
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'AVGO', 'GOOGL', 'GOOG', 'TSLA', 'COST', 'NFLX', 'TMUS', 'CSCO', 'PEP', 'ADBE', 'AMD', 'LIN', 'TXN',
  'QCOM', 'AMGN', 'INTU', 'ISRG', 'BKNG', 'HON', 'AMAT', 'CMCSA', 'VRTX', 'PANW', 'ADP', 'GILD', 'ADI', 'SBUX', 'MU', 'LRCX', 'MELI', 'KLAC',
  'INTC', 'CRWD', 'APP', 'CDNS', 'SNPS', 'REGN', 'MDLZ', 'PYPL', 'CTAS', 'MAR', 'ORLY', 'CEG', 'ASML', 'MRVL', 'FTNT', 'CSX', 'ADSK', 'DASH',
  'ABNB', 'PDD', 'WDAY', 'ROP', 'TEAM', 'CHTR', 'NXPI', 'PCAR', 'AEP', 'MNST', 'FANG', 'PAYX', 'KDP', 'ROST', 'FAST', 'ODFL', 'CPRT', 'BKR',
  'EA', 'XEL', 'VRSK', 'KHC', 'DDOG', 'EXC', 'CTSH', 'TTWO', 'LULU', 'CCEP', 'GEHC', 'IDXX', 'ZS', 'ANSS', 'TTD', 'CSGP', 'ON', 'MCHP',
  'DXCM', 'BIIB', 'CDW', 'GFS', 'ARM', 'MDB', 'TRI', 'WBD', 'ILMN', 'SMCI', 'PLTR', 'AXON', 'SHOP', 'LIN',
];

export const SP_500 = [
  'MMM', 'AOS', 'ABT', 'ABBV', 'ACN', 'ADBE', 'AMD', 'AES', 'AFL', 'A', 'APD', 'ABNB', 'AKAM', 'ALB', 'ARE', 'ALGN', 'ALLE', 'LNT', 'ALL', 'GOOGL',
  'GOOG', 'MO', 'AMZN', 'AMCR', 'AEE', 'AEP', 'AXP', 'AIG', 'AMT', 'AWK', 'AMP', 'AME', 'AMGN', 'APH', 'ADI', 'ANSS', 'AON', 'APA', 'AAPL', 'AMAT',
  'APTV', 'ACGL', 'ADM', 'ANET', 'AJG', 'AIZ', 'T', 'ATO', 'ADSK', 'ADP', 'AZO', 'AVB', 'AVY', 'AXON', 'BKR', 'BALL', 'BAC', 'BAX', 'BDX', 'BRK-B',
  'BBY', 'TECH', 'BIIB', 'BLK', 'BX', 'BK', 'BA', 'BKNG', 'BWA', 'BSX', 'BMY', 'AVGO', 'BR', 'BRO', 'BF-B', 'BLDR', 'BG', 'BXP', 'CHRW', 'CDNS',
  'CZR', 'CPT', 'CPB', 'COF', 'CAH', 'KMX', 'CCL', 'CARR', 'CAT', 'CBOE', 'CBRE', 'CDW', 'CE', 'COR', 'CNC', 'CNP', 'CF', 'CRL', 'SCHW', 'CHTR',
  'CVX', 'CMG', 'CB', 'CHD', 'CI', 'CINF', 'CTAS', 'CSCO', 'C', 'CFG', 'CLX', 'CME', 'CMS', 'KO', 'CTSH', 'CL', 'CMCSA', 'CAG', 'COP', 'ED',
  'STZ', 'CEG', 'COO', 'CPRT', 'GLW', 'CPAY', 'CTVA', 'CSGP', 'COST', 'CTRA', 'CRWD', 'CCI', 'CSX', 'CMI', 'CVS', 'DHR', 'DRI', 'DVA', 'DAY', 'DECK',
  'DE', 'DELL', 'DAL', 'DVN', 'DXCM', 'FANG', 'DLR', 'DFS', 'DG', 'DLTR', 'D', 'DPZ', 'DOV', 'DOW', 'DHI', 'DTE', 'DUK', 'DD', 'EMN', 'ETN',
  'EBAY', 'ECL', 'EIX', 'EW', 'EA', 'ELV', 'EMR', 'ENPH', 'ETR', 'EOG', 'EPAM', 'EQT', 'EFX', 'EQIX', 'EQR', 'ERIE', 'ESS', 'EL', 'EG', 'EVRG',
  'ES', 'EXC', 'EXPE', 'EXPD', 'EXR', 'XOM', 'FFIV', 'FDS', 'FICO', 'FAST', 'FRT', 'FDX', 'FIS', 'FITB', 'FSLR', 'FE', 'FI', 'FMC', 'F', 'FTNT',
  'FTV', 'FOXA', 'FOX', 'BEN', 'FCX', 'GRMN', 'IT', 'GE', 'GEHC', 'GEV', 'GEN', 'GNRC', 'GD', 'GIS', 'GM', 'GPC', 'GILD', 'GPN', 'GL', 'GDDY',
  'GS', 'HAL', 'HIG', 'HAS', 'HCA', 'DOC', 'HSIC', 'HSY', 'HES', 'HPE', 'HLT', 'HOLX', 'HD', 'HON', 'HRL', 'HST', 'HWM', 'HPQ', 'HUBB', 'HUM',
  'HBAN', 'HII', 'IBM', 'IEX', 'IDXX', 'ITW', 'INCY', 'IR', 'PODD', 'INTC', 'ICE', 'IFF', 'IP', 'IPG', 'INTU', 'ISRG', 'IVZ', 'INVH', 'IQV', 'IRM',
  'JBHT', 'JBL', 'JKHY', 'J', 'JNJ', 'JCI', 'JPM', 'JNPR', 'K', 'KVUE', 'KDP', 'KEY', 'KEYS', 'KMB', 'KIM', 'KMI', 'KKR', 'KLAC', 'KHC', 'KR',
  'LHX', 'LH', 'LRCX', 'LW', 'LVS', 'LDOS', 'LEN', 'LLY', 'LIN', 'LYV', 'LKQ', 'LMT', 'L', 'LOW', 'LULU', 'LYB', 'MTB', 'MPC', 'MKTX', 'MAR',
  'MMC', 'MLM', 'MAS', 'MA', 'MTCH', 'MKC', 'MCD', 'MCK', 'MDT', 'MRK', 'META', 'MET', 'MTD', 'MGM', 'MCHP', 'MU', 'MSFT', 'MAA', 'MRNA', 'MHK',
  'MOH', 'TAP', 'MDLZ', 'MPWR', 'MNST', 'MCO', 'MS', 'MOS', 'MSI', 'MSCI', 'NDAQ', 'NTAP', 'NFLX', 'NEM', 'NWSA', 'NWS', 'NEE', 'NKE', 'NI', 'NDSN',
  'NSC', 'NTRS', 'NOC', 'NCLH', 'NRG', 'NUE', 'NVDA', 'NVR', 'NXPI', 'ORLY', 'OXY', 'ODFL', 'OMC', 'ON', 'OKE', 'ORCL', 'OTIS', 'PCAR', 'PKG', 'PLTR',
  'PANW', 'PARA', 'PH', 'PAYX', 'PAYC', 'PYPL', 'PNR', 'PEP', 'PFE', 'PCG', 'PM', 'PSX', 'PNW', 'PNC', 'POOL', 'PPG', 'PPL', 'PFG', 'PG', 'PGR',
  'PLD', 'PRU', 'PEG', 'PTC', 'PSA', 'PHM', 'QRVO', 'PWR', 'QCOM', 'DGX', 'RL', 'RJF', 'RTX', 'O', 'REG', 'REGN', 'RF', 'RSG', 'RMD', 'RVTY',
  'ROK', 'ROL', 'ROP', 'ROST', 'RCL', 'SPGI', 'CRM', 'SBAC', 'SLB', 'STX', 'SRE', 'NOW', 'SHW', 'SPG', 'SWKS', 'SJM', 'SW', 'SNA', 'SOLV', 'SO',
  'LUV', 'SWK', 'SBUX', 'STT', 'STLD', 'STE', 'SYK', 'SMCI', 'SYF', 'SNPS', 'SYY', 'TMUS', 'TROW', 'TTWO', 'TPR', 'TRGP', 'TGT', 'TEL', 'TDY', 'TFX',
  'TER', 'TSLA', 'TXN', 'TXT', 'TMO', 'TJX', 'TSCO', 'TT', 'TDG', 'TRV', 'TRMB', 'TFC', 'TYL', 'TSN', 'USB', 'UBER', 'UDR', 'ULTA', 'UNP', 'UAL',
  'UPS', 'URI', 'UNH', 'UHS', 'VLO', 'VTR', 'VLTO', 'VRSN', 'VRSK', 'VZ', 'VRTX', 'VTRS', 'VICI', 'V', 'VST', 'VMC', 'WRB', 'GWW', 'WAB', 'WBA',
  'WMT', 'DIS', 'WBD', 'WM', 'WAT', 'WEC', 'WFC', 'WELL', 'WST', 'WDC', 'WY', 'WMB', 'WTW', 'WYNN', 'XEL', 'XYL', 'YUM', 'ZBRA', 'ZBH', 'ZTS',
];

export type UniverseId = 'ndx' | 'sp500' | 'both' | 'russell' | 'watchlist';

export const UNIVERSES: { id: UniverseId; label: string }[] = [
  { id: 'ndx', label: 'Nasdaq 100' },
  { id: 'sp500', label: 'S&P 500' },
  { id: 'both', label: 'Nasdaq 100 + S&P 500' },
  { id: 'russell', label: 'Russell 3000 (imported list)' },
  { id: 'watchlist', label: 'Watchlist' },
];

const RUSSELL_KEY = 'airGapRussell';

/** The Russell 3000 list the user imported (the app has no free source for it, so it is imported from a file) */
export const loadRussell = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RUSSELL_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
};

export const saveRussell = (symbols: string[]) => {
  try {
    localStorage.setItem(RUSSELL_KEY, JSON.stringify(symbols));
  } catch {
    /* storage unavailable */
  }
};

/**
 * Tickers from pasted text or a file: an iShares / Vanguard style holdings CSV (the Ticker column, equities only when
 * there is an asset class column) or any list separated by spaces, commas or lines.
 */
export const parseSymbolList = (text: string): string[] => {
  const clean = (s: string) => s.trim().replace(/^"|"$/g, '').toUpperCase().replace(/\./g, '-');
  const ok = (s: string) => /^[A-Z][A-Z0-9]{0,5}(-[A-Z])?$/.test(s);
  const lines = text.split(/\r?\n/);
  // a CSV with a header row naming a ticker column
  const split = (l: string) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const hi = lines.findIndex((l) => /(^|,)\s*"?(ticker|symbol)"?\s*(,|$)/i.test(l));
  if (hi >= 0) {
    const head = split(lines[hi]).map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase());
    const ti = head.findIndex((c) => c === 'ticker' || c === 'symbol');
    const ai = head.findIndex((c) => c === 'asset class');
    const out: string[] = [];
    for (const l of lines.slice(hi + 1)) {
      const cells = split(l);
      if (cells.length <= ti) continue;
      if (ai >= 0 && !/equity/i.test(cells[ai] ?? '')) continue;
      const t = clean(cells[ti] ?? '');
      if (ok(t)) out.push(t);
    }
    if (out.length) return [...new Set(out)];
  }
  return [...new Set(text.split(/[\s,;]+/).map(clean).filter(ok))];
};

export const universeSymbols = (id: UniverseId, watchlist: string[], russell: string[] = []): string[] => {
  const list = id === 'ndx' ? NASDAQ_100 : id === 'sp500' ? SP_500 : id === 'both' ? [...NASDAQ_100, ...SP_500] : id === 'russell' ? russell : watchlist;
  return [...new Set(list.map((s) => s.toUpperCase()))];
};
