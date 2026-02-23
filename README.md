# time.track

Time registration for small teams. One shared password, pick your name, log hours. That's it.

Built with React + Vite, Supabase for storage, deployed on GitHub Pages.

---

## Forking this

### What you need
- Node.js 18+
- A free [Supabase](https://supabase.com) account

### 1. Set up Supabase

Create a new project, then run this in the SQL editor:

```sql
create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now(),
  deleted_at timestamptz default null
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#f5a623',
  archived boolean default false,
  created_at timestamptz default now(),
  deleted_at timestamptz default null
);

create table project_members (
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  primary key (project_id, user_id)
);

create table time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  date date not null,
  hours numeric(5,2) not null,
  notes text,
  created_at timestamptz default now(),
  deleted_at timestamptz default null
);

create table settings (
  key text primary key,
  value text not null
);

alter table users enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table time_entries enable row level security;
alter table settings enable row level security;

create policy "public read/write users" on users for all using (true) with check (true);
create policy "public read/write projects" on projects for all using (true) with check (true);
create policy "public read/write project_members" on project_members for all using (true) with check (true);
create policy "public read/write time_entries" on time_entries for all using (true) with check (true);
create policy "public read/write settings" on settings for all using (true) with check (true);
```
 
Then grab your **Project URL** and **anon key** from Settings → API.

### 2. Environment variables

Create a `.env` file in the project root — this stays local and is gitignored:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 3. Run it

```bash
npm install
npm run dev
```

First time you open it, you'll be asked to set an org password. This is one shared password for the whole team — just send it to your coworkers.

---

## Deploying to GitHub Pages

In `vite.config.js`, set the base to your repo name:

```js
export default {
  base: '/your-repo-name/',
}
```

Add your Supabase credentials as repository secrets (Settings → Secrets → Actions):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The included GitHub Actions workflow handles the rest on every push to `main`. Once deployed, go to Settings → Pages and make sure the source is set to the `gh-pages` branch.

---

## A few things worth knowing

**Deletes are soft.** Removing an entry sets a `deleted_at` timestamp — nothing actually gets deleted from the database. You can recover anything from the Supabase table editor if needed.

**Users can only delete their own entries.** Other people's entries are read-only.

**Forgot the org password?** Delete the row with `key = 'org_password'` from the `settings` table in Supabase and you'll be prompted to create a new one.