export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_ORIGIN: string;
  ENVIRONMENT: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  BACKUPS?: R2Bucket;
}
export type Bindings = {
  Bindings: Env;
  Variables: { email: string | null };
};
