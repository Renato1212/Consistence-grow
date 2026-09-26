import type { Database } from "./database.types";

type PublicSchema = Database["public"];

/** Row type of a public table, e.g. `Row<"trades">`. */
export type Row<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type Insert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type Update<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];
export type ViewRow<T extends keyof PublicSchema["Views"]> = PublicSchema["Views"][T]["Row"];
