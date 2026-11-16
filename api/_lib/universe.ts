// Symbols the scanner covers: large, liquid US stocks and ETFs plus popular momentum names. Edit freely: symbols
// that no longer exist are skipped automatically. Your watchlist is added on top of this list.
export const SCAN_UNIVERSE: string[] = [
  // mega and large caps
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'GOOG', 'META', 'TSLA', 'AVGO', 'BRK-B', 'LLY', 'JPM', 'V', 'UNH', 'XOM', 'WMT', 'MA', 'PG', 'JNJ', 'HD',
  'COST', 'ABBV', 'ORCL', 'BAC', 'MRK', 'CVX', 'KO', 'NFLX', 'CRM', 'AMD', 'PEP', 'TMO', 'ADBE', 'LIN', 'WFC', 'ACN', 'MCD', 'CSCO', 'ABT', 'DIS',
  'INTU', 'QCOM', 'TXN', 'GE', 'IBM', 'CAT', 'AMGN', 'VZ', 'PM', 'NOW', 'ISRG', 'DHR', 'UBER', 'BKNG', 'SPGI', 'T', 'RTX', 'NEE', 'LOW', 'PFE',
  'AXP', 'HON', 'GS', 'UNP', 'BLK', 'MS', 'PGR', 'ETN', 'SYK', 'C', 'VRTX', 'COP', 'BSX', 'LMT', 'ADP', 'SBUX', 'MDT', 'TJX', 'BA', 'PLD',
  'ADI', 'CB', 'MMC', 'DE', 'PANW', 'SCHW', 'MU', 'GILD', 'ANET', 'LRCX', 'KLAC', 'INTC', 'AMAT', 'REGN', 'MDLZ', 'CI', 'CME', 'SO', 'BX', 'ICE',
  'MO', 'SHW', 'CDNS', 'SNPS', 'APH', 'PYPL', 'USB', 'MAR', 'CVS', 'FDX', 'NKE', 'TGT', 'MMM', 'EMR',
  // semis, software, internet
  'TSM', 'ASML', 'MRVL', 'ON', 'WDC', 'STX', 'SMCI', 'ARM', 'CRWD', 'NET', 'DDOG', 'ZS', 'SNOW', 'MDB', 'TEAM', 'OKTA', 'TTD', 'ZM', 'DOCU', 'PATH',
  'SHOP', 'ABNB', 'DASH', 'LYFT', 'PINS', 'SNAP', 'ROKU', 'RBLX', 'U', 'DKNG', 'AFRM', 'UPST', 'SOFI', 'HOOD', 'COIN', 'MSTR', 'PLTR', 'AI',
  // autos, travel, retail momentum
  'RIVN', 'LCID', 'NIO', 'XPEV', 'LI', 'F', 'GM', 'CVNA', 'AAL', 'DAL', 'UAL', 'CCL', 'NCLH', 'AMC', 'GME', 'BB', 'NOK', 'BABA', 'JD', 'PDD', 'BIDU', 'NU',
  // space, quantum, nuclear, eVTOL
  'ASTS', 'RKLB', 'LUNR', 'IONQ', 'RGTI', 'QUBT', 'JOBY', 'ACHR', 'OKLO', 'SMR',
  // ETFs
  'SPY', 'QQQ', 'IWM', 'DIA', 'XLF', 'XLE', 'XLK', 'XLV', 'XLY', 'XLP', 'XLU', 'XLI', 'XLB', 'XLC', 'SMH', 'SOXL', 'TQQQ', 'SQQQ', 'ARKK', 'GLD', 'SLV', 'TLT', 'HYG', 'USO', 'UVXY', 'VXX',
];
