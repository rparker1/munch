/* ==========================================================================
   Cloud configuration.

   With these two set, the app gains email sign-in and sync across devices. Blank
   them and it carries on exactly as before, storing everything on the device only
   — nothing else in the app assumes they are filled in.

   The publishable key is designed to be handed to browsers and is safe to commit.
   What keeps the data private is row-level security in the database, verified on
   this project: a request carrying only this key sees nothing at all, and a
   signed-in user can only read and write their own rows. The service_role key has
   none of those protections and must never appear in this repo.
   ========================================================================== */

export const SUPABASE = {
  url: 'https://aaticbarhuvbjmfjtfey.supabase.co',
  anonKey: 'sb_publishable_1fD_0tbktXigVz2vRUeH3A_520CmNZD',
};

export const cloudConfigured = () => !!(SUPABASE.url && SUPABASE.anonKey);
