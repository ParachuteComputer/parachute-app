// tsconfig.node.json compiles scripts/ without Bun's types (see the note in
// verify-dist.ts) — declare the sliver of bun:sqlite the backdater uses.
declare module "bun:sqlite" {
  export class Database {
    constructor(path: string);
    query(sql: string): { all(): unknown[] };
    prepare(sql: string): { run(...params: Array<string | number | null>): void };
    run(sql: string): void;
    close(): void;
  }
}
