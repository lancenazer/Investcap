// Fallback sample data, used only when the Finnhub proxy is unreachable. Live quotes overwrite prices.
// Indices are tracked through ETF proxies (Finnhub free tier has no index quotes).
window.SAMPLE = {
  indices: [
    { symbol: "S&P 500", proxy: "SPY", price: 5987.42, prev: 5951.1 },
    { symbol: "Dow", proxy: "DIA", price: 43210.88, prev: 43302.5 },
    { symbol: "Nasdaq 100", proxy: "QQQ", price: 19480.15, prev: 19301.7 },
    { symbol: "Russell 2000", proxy: "IWM", price: 2312.6, prev: 2306.9 },
  ],
  holdings: [
    { symbol: "SPYG", name: "SPDR Portfolio S&P 500 Growth ETF", cls: "ETF", issuer: "State Street", price: 84.92, prev: 84.82, shares: 0.05925, cost: 85.4 },
    { symbol: "AAPL", name: "Apple Inc.", cls: "Stock", issuer: "Apple", price: 228.14, prev: 226.01, shares: 12, cost: 189.5 },
    { symbol: "NVDA", name: "NVIDIA Corporation", cls: "Stock", issuer: "NVIDIA", price: 141.7, prev: 144.9, shares: 25, cost: 98.2 },
    { symbol: "VOO", name: "Vanguard S&P 500 ETF", cls: "ETF", issuer: "Vanguard", price: 549.3, prev: 546.8, shares: 4.5, cost: 498.0 },
    { symbol: "MSFT", name: "Microsoft Corporation", cls: "Stock", issuer: "Microsoft", price: 421.55, prev: 418.2, shares: 6, cost: 390.1 },
    { symbol: "QQQ", name: "Invesco QQQ Trust", cls: "ETF", issuer: "Invesco", price: 512.08, prev: 514.3, shares: 3, cost: 455.0 },
  ],
  watchlist: [
    { symbol: "TSLA", name: "Tesla, Inc.", cls: "Stock", issuer: "Tesla", price: 251.3, prev: 246.9 },
    { symbol: "AMZN", name: "Amazon.com, Inc.", cls: "Stock", issuer: "Amazon", price: 197.8, prev: 196.4 },
    { symbol: "GOOGL", name: "Alphabet Inc.", cls: "Stock", issuer: "Alphabet", price: 168.9, prev: 169.7 },
    { symbol: "META", name: "Meta Platforms, Inc.", cls: "Stock", issuer: "Meta", price: 574.2, prev: 569.0 },
    { symbol: "SCHD", name: "Schwab US Dividend Equity ETF", cls: "ETF", issuer: "Schwab", price: 28.41, prev: 28.35 },
  ],
  news: [
    { src: "Market Wire", ago: "12m", title: "Stocks edge higher as tech rebounds ahead of earnings season", tag: "Markets" },
    { src: "Chip Daily", ago: "47m", title: "NVIDIA dips as investors take profits after record run", tag: "NVDA" },
    { src: "Fed Watch", ago: "2h", title: "Rate-cut expectations shift after latest inflation reading", tag: "Economy" },
    { src: "Fund Focus", ago: "3h", title: "Growth ETFs see steady inflows as retail demand holds up", tag: "ETFs" },
    { src: "Market Wire", ago: "5h", title: "Apple supplier signals strong demand for upcoming product cycle", tag: "AAPL" },
  ],
};
