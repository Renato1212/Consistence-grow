import { prepareStatement } from "../src/lib/statements/payload";
import {
  DEFAULT_PRODUCTS,
  MES_THREE_TRADES_PRODUCT,
  buildAxiaStatementPdf,
} from "../tests/fixtures/axia-statement";
import { E2E_USER, signedIn } from "../tests/local-supabase";

/** Saves a statement (MES with three trades + ZN) for a random future weekday; returns its page. */
export async function seedStatementPage(): Promise<string> {
  let day = "";
  for (;;) {
    const d = new Date(Date.UTC(2036, 0, 1) + Math.floor(Math.random() * 1400) * 86_400_000);
    if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) {
      day = d.toISOString().slice(0, 10);
      break;
    }
  }
  const bytes = await buildAxiaStatementPdf({
    tradeDate: day,
    account: `OBS_SCAN_${Date.now()}`,
    products: [MES_THREE_TRADES_PRODUCT, DEFAULT_PRODUCTS.find((p) => p.code === "21")!],
  });
  const { payload } = await prepareStatement(bytes);
  const { client } = await signedIn(E2E_USER);
  const r = await client.rpc("save_statement", { p_statement: payload });
  if (r.error) throw r.error;
  return `/statements/${(r.data as { id: string }).id}`;
}
