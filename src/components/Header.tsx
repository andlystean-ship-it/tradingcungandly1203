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
        </select>
      </div>
    </div>
  );
}
