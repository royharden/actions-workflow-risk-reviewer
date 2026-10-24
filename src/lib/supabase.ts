import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getMode } from './mode';
let client: SupabaseClient | null = null;
/** Configuration stays lazy: offline demo never constructs a network client. */
export function getSupabase(): SupabaseClient | null {
  if (getMode().kind !== 'live') return null;
  if (!client) client = createClient(import.meta.env.VITE_SUPABASE_URL!, import.meta.env.VITE_SUPABASE_ANON_KEY!);
  return client;
}
