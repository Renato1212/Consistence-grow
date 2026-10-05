/**
 * The 3-tap check before the midday scalp block: which side is winning so
 * far, is it a trend day, does the higher timeframe agree. The answer is the
 * block's bias (and the default direction when logging from it).
 */
export type ScalpCheck = {
  side?: "long" | "short" | "unclear";
  trend?: "yes" | "no";
  htf?: "yes" | "no";
};

export type ScalpBias = { side: "long" | "short" | null; text: string };

export function scalpBias(check: ScalpCheck): ScalpBias | null {
  if (!check.side) return null;
  if (check.side === "unclear")
    return { side: null, text: "No clear winner yet: wait for one, or trade smaller." };
  const side = check.side;
  const word = side === "long" ? "long" : "short";
  if (check.trend === "yes" && check.htf === "yes")
    return {
      side,
      text: `Trend day with the 1h behind it: go with the ${word} side and let winners run.`,
    };
  if (check.trend === "yes")
    return { side, text: `Trend day, 1h not aligned: ${word} scalps only, take profits quickly.` };
  if (check.trend === "no")
    return { side, text: `No trend: scalp ${word} from fresh 1-min zones, quick targets.` };
  return { side, text: `Winning side: ${word}. Scalp with it.` };
}
