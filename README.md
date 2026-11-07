# St. Joseph Rehema College Computer Lab

A private inventory for 13 workstation slots. Register monitors and system units in Equipment, then link one of each in a workstation record. Removing an assignment keeps both equipment records. The A4 PDF includes workstation pairings, equipment and maintenance.

## Local validation

Use Node.js 24.

```sh
npm ci
npm test
npm run dev
```

The local preview uses an isolated SQLite database in memory. The owner identity in the preview is for local testing. The hosted worker requires the authenticated identity provided by its private hosting gateway.

## Private Vercel deployment with Supabase

1. Push the source into a private GitHub repository. Import that repository into Vercel using the root configuration.
2. Provision a dedicated Supabase project and apply the SQL migration in `supabase/migrations`. The migration uses the private `rehema_lab` schema and creates a limited, non-login role named `rehema_lab_app`.
3. With an administrator PostgreSQL connection, create a dedicated login and grant it membership. Set a strong password for that login with the interactive `\password rehema_lab_runtime` command in psql.

   ```sql
   create role rehema_lab_runtime login;
   grant rehema_lab_app to rehema_lab_runtime;
   ```

4. In Vercel, set `LAB_DATABASE_URL` to the Supabase transaction-pooler URL for the dedicated login. Use the pooler's host and port from Supabase. For Supavisor, replace the standard `postgres.PROJECT_REF` username with `rehema_lab_runtime.PROJECT_REF`. Set `LAB_ACCESS_PASSWORD` to a distinct owner password of at least 20 characters. The web login username is `owner`. Store both settings as server secrets.
5. Enable Vercel Authentication for all deployments and verify signed-out requests are denied before sharing any URL.

Vercel uses PostgreSQL, while the existing private Sites deployment uses D1. These databases are separate. A hosting move requires an explicit data transfer and verification before switching the link users rely on. The app needs a server runtime to persist edits and generate reports.

No custom domain is required for PDF generation.
