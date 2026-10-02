# Oakmere site portal

Sign in/out, yearly site induction and a subcontractor RAMS register, for Oakmere acting as Principal Contractor.
Node.js / Express / PostgreSQL, hosted on Railway. Starts completely empty.

## Deploy on Railway

1. Push this folder to a new GitHub repo (for example `oakmere-site-portal`).
2. In Railway: New Project > Deploy from GitHub repo > pick the repo.
3. In the same project: New > Database > PostgreSQL.
4. On the portal service, Variables:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `SETUP_KEY` = any long phrase (used once to create the first admin)
   - `NODE_ENV` = `production`
   - `PUBLIC_URL` = the final address, for example `https://oakmere.safety-simplified.com` (optional; used in QR codes and kiosk links)
5. Settings > Networking > Generate Domain.
6. Open `/admin`, enter the setup key and create the first admin account.

The database schema is created and updated automatically every time the server starts, so there is no manual migration step.
`npm run migrate` (with `DATABASE_URL` set to the public Postgres URL) does the same thing by hand if needed.

## First-time setup inside the portal

1. Sites: add each site with its location and boundary radius, plus the site information (assembly point, first aid, welfare, rules).
   Print the QR poster for the cabin. Set up a kiosk if the site has a tablet.
2. Subcontractors: add the firms. These fill the drop-down when operatives register.
3. Induction: start a blank induction, build it from the current template, publish.
   Each January use "Start next year's version", update it, publish; everyone redoes it at their next sign-in.
4. RAMS register: add RAMS as subcontractors send them in, review, and mark accepted or returned.

## How sign-in works

- Phone: scan the site QR, register once (name, mobile, company, trade, card, emergency contact), complete the induction, confirm the site information.
- Every sign-in: confirm briefing on any newly accepted RAMS for their company at that site, take a photo, location checked against the site boundary.
- Sign-out: photo required. Anyone not signed out by midnight is closed at 23:59 and flagged.
- Kiosk: same flow on a site tablet using mobile number and surname, no location check.
- Refused attempts (outside boundary, no photo, no induction) are logged.

## Roles

Admin (everything including users), Manager (everything except users), View only.
