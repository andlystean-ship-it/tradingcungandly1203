import type { Symbol, Direction } from "../types";

type Props = {
  direction: Direction;
  symbol: Symbol;
  onDirectionChange: (d: Direction) => void;
  onSymbolChange: (s: Symbol) => void;
};

export default function Header({
  direction,
  symbol,
  onDirectionChange,
  onSymbolChange,
}: Props) {
  return (
    <div className="header">
      <div className="header-logo">SC</div>
      <div className="header-title">Crypto &amp; Forex Trading</div>
      <div className="header-controls">
        <select
          className="select-pill"
          value={direction}
          onChange={(e) => onDirectionChange(e.target.value as Direction)}
        >
          <option value="long">Lệnh Chờ Long</option>
          <option value="short">Lệnh Chờ Short</option>
        </select>
        <select
          className="select-pill"
          value={symbol}
          onChange={(e) => onSymbolChange(e.target.value as Symbol)}
        >
          <option value="XAU/USDT">XAU/USDT - Vàng</option>
          <option value="BTC/USDT">BTC/USDT - Bitcoin</option>
          <option value="ETH/USDT">ETH/USDT - Ethereum</option>
          <option value="SOL/USDT">SOL/USDT - Solana</option>
          <option value="BNB/USDT">BNB/USDT - BNB</option>
          <option value="XRP/USDT">XRP/USDT - Ripple</option>
          <option value="ADA/USDT">ADA/USDT - Cardano</option>
          <option value="DOGE/USDT">DOGE/USDT - Dogecoin</option>
          <option value="DOT/USDT">DOT/USDT - Polkadot</option>
          <option value="AVAX/USDT">AVAX/USDT - Avalanche</option>
          <option value="LINK/USDT">LINK/USDT - Chainlink</option>
          <option value="SUI/USDT">SUI/USDT - Sui</option>
        </select>
      </div>
    </div>
  );
}
