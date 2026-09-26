import { E2E_USER, signedIn } from "../tests/local-supabase";

/**
 * Seeds 12 ES trades on a fresh playbook (as the E2E user, local stack only):
 * 8 Tuesday longs at +2R (confidence 4) and 4 Thursday shorts at −1R (confidence 2), no fees.
 * Expectancy (16 − 4) / 12 = +1.00R, win rate 8/12 = 67%.
 */
export async function seedPlaybookTrades(name: string): Promise<{ playbookId: string }> {
  const { client } = await signedIn(E2E_USER);
  const { data: es, error: e1 } = await client
    .from("instruments")
    .select("id")
    .eq("symbol", "ES")
    .is("deleted_at", null)
    .single();
  if (e1) throw e1;
  const { data: pb, error: e2 } = await client
    .from("playbooks")
    .insert({ name, primary_domain: "DATA", status: "testing" })
    .select("id")
    .single();
  if (e2) throw e2;
  const tuesdays = ["02", "09", "16", "23", "30"].map((d) => `2021-03-${d}`);
  tuesdays.push("2021-04-06", "2021-04-13", "2021-04-20");
  const thursdays = ["04", "11", "18", "25"].map((d) => `2021-03-${d}`);
  const base = {
    instrument_id: es.id,
    playbook_id: pb.id,
    primary_domain: "DATA",
    contracts: 1,
    fees: 0,
  };
  const rows = [
    ...tuesdays.map((d) => ({
      ...base,
      direction: "long",
      confidence: 4,
      entry_at: `${d}T15:00:00Z`,
      exit_at: `${d}T15:10:00Z`,
      entry_price: 5000,
      stop_price: 4998,
      exit_price: 5004,
    })),
    ...thursdays.map((d) => ({
      ...base,
      direction: "short",
      confidence: 2,
      entry_at: `${d}T15:00:00Z`,
      exit_at: `${d}T15:05:00Z`,
      entry_price: 5000,
      stop_price: 5002,
      exit_price: 5002,
    })),
  ];
  const { error: e3 } = await client.from("trades").insert(rows);
  if (e3) throw e3;
  return { playbookId: pb.id };
}
