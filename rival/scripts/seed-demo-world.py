"""Demo world for Apple's beta review (Harbour Run Club).
Deterministic ids (uuid5), so re-running is safe: every insert is ON CONFLICT DO NOTHING.
Writes seed.sql next to this file."""
import json, math, random, uuid
from datetime import datetime, timedelta, timezone, date

random.seed(42)
NS = uuid.NAMESPACE_DNS
def uid(*k): return str(uuid.uuid5(NS, 'rival-demo-' + '-'.join(map(str, k))))
def q(v):
    if v is None: return 'null'
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return repr(v)
    if isinstance(v, (dict, list)): return q(json.dumps(v)) + '::jsonb'
    return "'" + str(v).replace("'", "''") + "'"

PHOTO = 'https://dgauxvrvqnkbfvarexok.supabase.co/storage/v1/object/public/activity-photos/demo/%s.jpg'
AVATAR = 'https://dgauxvrvqnkbfvarexok.supabase.co/storage/v1/object/public/avatars/%s/avatar-demo.jpg'

HARBOUR = 'ebde36b5-6479-4a2c-8de6-4558490aed1e'
NORTHSIDE = '2b95f2d2-ae5d-465d-9aec-7a897ce83ca8'
ALEX = 'cf337489-5fd5-498a-89ce-ce0f2801d087'
MAYA = '880d0205-1d23-4882-bf06-5e0770561c53'
JORDAN = '5cd92d83-d263-4358-9222-b6bbe93748bc'
SAM = '661067b0-4eb3-42ff-ab2f-38c4880cb412'
REV = '04b3805d-fad1-4b78-8359-e779d34d9cc6'
TESS = uid('user', 'tess'); PRIYA = uid('user', 'priya'); LIAM = uid('user', 'liam'); KAI = uid('user', 'kai')
assert TESS == '4add5d4d-e200-53d4-abc7-1b362b49212f'
NEW = [
    (TESS, 'Tess Morgan', 'demo-tess@rival.internal', AVATAR % TESS, 'Trail runner. Happiest above the tree line.'),
    (PRIYA, 'Priya Shah', 'demo-priya@rival.internal', None, 'Lifting, swimming and the odd long run.'),
    (LIAM, "Liam O'Connor", 'demo-liam@rival.internal', None, 'Training for my first half Ironman.'),
    (KAI, 'Kai Nakamura', 'demo-kai@rival.internal', None, 'Rowing and long walks with the dog.'),
]
NAME = {ALEX: 'Alex', MAYA: 'Maya', JORDAN: 'Jordan', SAM: 'Sam', TESS: 'Tess', PRIYA: 'Priya', LIAM: 'Liam', KAI: 'Kai', REV: 'you'}
TEAM = [ALEX, MAYA, JORDAN, SAM, TESS, PRIYA, LIAM, KAI]

out = []
W = out.append
W('begin;')

# ---- users -------------------------------------------------------------
for i, (id_, name, email, av, bio) in enumerate(NEW):
    W(f"""insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change)
values ('00000000-0000-0000-0000-000000000000',{q(id_)},'authenticated','authenticated',{q(email)},'',now(),'{{"provider":"email","providers":["email"]}}',{q({'display_name': name, 'email_verified': True})}::jsonb,now() - interval '{70 + i * 9} days',now(),'','','','') on conflict (id) do nothing;""")
    W(f"update public.users set display_name={q(name)}, avatar_url={q(av)}, bio={q(bio)}, timezone='America/Vancouver', created_at=now() - interval '{70 + i * 9} days' where id={q(id_)};")
for id_, bio in [(MAYA, 'Chasing a sub-1:45 half this winter.'), (JORDAN, 'Squat, bench, deadlift. Repeat.'), (SAM, 'Weekend climbs and coffee stops.'), (ALEX, 'Swim, bike, run. Harbour Run Club founder.')]:
    W(f"update public.users set bio={q(bio)}, timezone='America/Vancouver' where id={q(id_)} and bio is null;")

# Members of Harbour Run Club.
for m in [TESS, PRIYA, LIAM, KAI]:
    W(f"insert into league_members (league_id,user_id,joined_at) values ({q(HARBOUR)},{q(m)},now() - interval '60 days') on conflict (league_id,user_id) do nothing;")
# An invite for the reviewer to a second team (shows in the inbox, to accept or decline).
W(f"insert into league_members (league_id,user_id,status,invited_by,invite_state,invite_sent_at,joined_at) values ({q(NORTHSIDE)},{q(REV)},'pending',{q(JORDAN)},'teammate',now() - interval '5 hours',now() - interval '5 hours') on conflict (league_id,user_id) do nothing;")

# ---- routes ------------------------------------------------------------
def encode(points):
    res, plat, plng = [], 0, 0
    for lat, lng in points:
        la, ln = int(round(lat * 1e5)), int(round(lng * 1e5))
        for d in (la - plat, ln - plng):
            d = ~(d << 1) if d < 0 else d << 1
            while d >= 0x20:
                res.append(chr((0x20 | (d & 0x1f)) + 63)); d >>= 5
            res.append(chr(d + 63))
        plat, plng = la, ln
    return ''.join(res)

ANCHORS = {
    'seawall': (49.3005, -123.1420), 'falsecreek': (49.2715, -123.1150), 'spirit': (49.2560, -123.2050),
    'kits': (49.2740, -123.1580), 'lynn': (49.3450, -123.0180), 'cypress': (49.3700, -123.2050),
    'grouse': (49.3600, -123.0850), 'deepcove': (49.3290, -122.9480), 'jericho': (49.2720, -123.1950),
}
def route(anchor, km, seed):
    r = random.Random(seed)
    lat0, lng0 = ANCHORS[anchor]
    radius_km = km / (2 * math.pi) if km < 30 else km / 9  # long rides: wider shape, partly out-and-back
    n = max(60, int(km * 12))
    pts = []
    ph = r.random() * 6.28
    for i in range(n + 1):
        t = 2 * math.pi * i / n
        wob = 1 + 0.12 * math.sin(3 * t + ph) + 0.06 * math.sin(7 * t + ph * 2) + r.uniform(-0.01, 0.01)
        dy = radius_km * wob * math.sin(t) * (0.75 if km < 30 else 0.5)
        dx = radius_km * wob * math.cos(t) * 1.3
        pts.append((lat0 + dy / 111.0, lng0 + dx / (111.0 * math.cos(math.radians(lat0)))))
    return encode(pts)

# ---- activities ----------------------------------------------------------
NOW = datetime(2026, 11, 11, 2, 0, tzinfo=timezone.utc)
START = date(2026, 9, 14)  # Monday, 8 weeks back
def at(day, hh, mm=0):
    off = -7 if day < date(2026, 11, 1) else -8
    local = datetime(day.year, day.month, day.day, hh, mm, tzinfo=timezone(timedelta(hours=off)))
    return local.astimezone(timezone.utc), off * 3600

ACTS = []  # dicts
def act(user, day, hh, typ, name, mins, km=None, elev=0, photo=None, anchor=None, notes=None, hr=None, exercises=None, race_id=None, location=None, mm=0, best=None):
    st, off = at(day, hh, mm)
    if st > NOW: return None
    a = dict(id=uid('act', user, day.isoformat(), hh, typ), user=user, type=typ, name=name, started_at=st, off=off,
             dur=int(mins * 60), dist=round(km * 1000) if km else None, elev=elev, photo=PHOTO % photo if photo else None,
             poly=route(anchor, km, f'{user}{day}{typ}') if anchor and km else None, notes=notes, hr=hr, ex=exercises,
             race_id=race_id, location=location, best=best)
    ACTS.append(a); return a

def run_best(km, pace_s):  # pace in s/km for the whole run; parts slightly quicker
    out = []
    for m, nm in [(400, '400m'), (1000, '1k'), (1609.34, '1 mile'), (5000, '5k'), (10000, '10k'), (21097.5, 'Half-Marathon')]:
        if km * 1000 >= m - 30:
            f = 0.93 if m <= 1609.34 else (0.97 if m < km * 1000 - 300 else 1.0)
            out.append({'name': nm, 'distance': m, 'seconds': int(m / 1000 * pace_s * f)})
    return out

def days(week, *dows):
    base = START + timedelta(weeks=week)
    return [base + timedelta(days=d) for d in dows]

RUN_PH = ['ridge-runners-hazy-backlit', '2-3-trail-runners-moving-along-a', 'sunset-beach-group-walking', 'a-small-group-of-diverse-athletes-2']
GYM_PH = ['deadlift-rival-plates-box', 'overhead-squat-warehouse-gym', 'rope-climb-atelier-gym', 'handstand-crossfit-box']

# Races (events)
RACE_10K = uid('race', 'seawall10k'); RACE_HALF = uid('race', 'harbourhalf'); RACE_GF = uid('race', 'granfondo')
W(f"""insert into races (id,user_id,name,race_type,distance_km,race_date,location,registration_url,is_public,created_at,goal_finish_time,actual_finish_time) values
({q(RACE_10K)},{q(MAYA)},'Seawall 10K','Run',10,'2026-10-18','Stanley Park, Vancouver','https://therivalapp.com',true,now()-interval '50 days','45:00','44:12'),
({q(RACE_HALF)},{q(MAYA)},'Harbour Half Marathon','Run',21.1,'2026-12-06','Coal Harbour, Vancouver','https://therivalapp.com',true,now()-interval '40 days','1:44:59',null),
({q(RACE_GF)},{q(SAM)},'Sea to Sky Gran Fondo','Ride',122,'2027-05-15','Vancouver to Whistler','https://therivalapp.com',true,now()-interval '20 days','4:45:00',null)
on conflict (id) do nothing;""")
for r_, users in [(RACE_HALF, [MAYA, LIAM, TESS, ALEX, KAI]), (RACE_GF, [SAM, LIAM, PRIYA])]:
    for u in users:
        W(f"insert into race_interests (id,race_id,user_id,created_at) values ({q(uid('ri', r_, u))},{q(r_)},{q(u)},now()-interval '{random.randint(3, 30)} days') on conflict (id) do nothing;")

for w in range(8):
    prog = w / 7.0
    # Maya: runner, long run builds 14 -> 21 km, 5k pace improves
    d = days(w, 1, 3, 5, 6)
    act(MAYA, d[0], 6, 'Run', 'Easy seawall loop', 40 + w, 7 + w * 0.2, 25, anchor='seawall', hr=142, best=run_best(7 + w * 0.2, 335))
    pace5 = 300 - w * 4
    if w == 5:
        act(MAYA, date(2026, 10, 18), 8, 'Run', 'Seawall 10K', 44.2, 10.0, 30, photo='trail-sisters-finish-line', anchor='seawall', hr=171,
            notes='Race day. Under 45 minutes for the first time. Thank you all for the cheering at the finish.', race_id=RACE_10K,
            best=run_best(10, 265), location='Stanley Park, Vancouver')
    else:
        act(MAYA, d[1], 6, 'Run', 'Tempo intervals' if w % 2 else '5K time trial', 32, 6.2, 20, anchor='falsecreek', hr=165, best=run_best(5.0, pace5) + [])
    act(MAYA, d[2], 18, 'Yoga', 'Recovery yoga', 45, hr=95)
    lk = 14 + w
    act(MAYA, d[3], 7, 'Run', f'Long run, {lk} km', lk * 5.75, lk, 120 + w * 10, photo=RUN_PH[w % 4] if w % 2 == 0 else None, anchor='spirit', hr=150,
        best=run_best(lk, 345), notes='Negative split the last 5 km.' if w == 7 else None)

    # Jordan: strength; squat/bench/deadlift climb -> lift PBs
    sq, bp, dl = 120 + w * 5, 85 + w * 2.5, 150 + w * 7.5
    for i, dd in enumerate(days(w, 0, 2, 4)):
        ex = [[{'name': 'Squat', 'weight': sq, 'sets': 5, 'reps': 5}, {'name': 'Romanian Deadlift', 'weight': 100, 'sets': 3, 'reps': 8}],
              [{'name': 'Bench Press', 'weight': bp, 'sets': 5, 'reps': 5}, {'name': 'Pull-up', 'weight': 0, 'sets': 4, 'reps': 10}],
              [{'name': 'Deadlift', 'weight': dl, 'sets': 3, 'reps': 3}, {'name': 'Overhead Press', 'weight': 55 + w, 'sets': 4, 'reps': 6}]][i]
        nm = ['Leg day', 'Push and pull', 'Deadlift day'][i]
        act(JORDAN, dd, 17, 'WeightTraining', nm, 60 + random.randint(-5, 10), exercises=ex, hr=118,
            photo=GYM_PH[(w + i) % 4] if (w + i) % 3 == 0 else None,
            notes=f'Deadlift {dl:g} kg for a triple. Felt strong.' if i == 2 and w >= 6 else None)
    act(JORDAN, days(w, 6)[0], 9, 'Run', 'Sunday jog', 30, 5.0, 15, anchor='kits', hr=148, best=run_best(5, 360))

    # Sam: cyclist
    d = days(w, 2, 5, 6)
    act(SAM, d[0], 6, 'Ride', 'Spanish Banks spin', 75, 38 + w, 220, anchor='jericho', hr=138)
    act(SAM, d[1], 8, 'Ride', 'Cypress climb' if w % 2 else 'Sea to Sky out and back', 150 + w * 8, 70 + w * 4, 1150 + w * 40,
        photo='coastal-highway-triathlete-dusk-3' if w % 2 == 0 else None, anchor='cypress', hr=146)
    if w % 2: act(SAM, d[2], 10, 'MountainBikeRide', 'North Shore trails', 110, 22, 650, photo='mountain-bikers-forest-trail', anchor='lynn', hr=150)

    # Tess: trail runs and hikes with big elevation
    d = days(w, 1, 3, 5)
    act(TESS, d[0], 6, 'TrailRun', 'Lynn loop', 70, 11 + w * 0.5, 420, anchor='lynn', hr=152)
    act(TESS, d[1], 6, 'Run', 'Easy run', 45, 8, 60, anchor='falsecreek', hr=140, best=run_best(8, 330))
    act(TESS, d[2], 7, 'Hike' if w % 2 else 'TrailRun', 'Grouse Grind' if w % 2 else 'Baden-Powell section', 75 + w * 10, 3 + w if w % 2 else 18 + w, 850 + w * 60,
        photo='trail-runner-summit-marker' if w in (3, 7) else ('a-clear-ascending-mountain-trail' if w == 5 else None), anchor='grouse', hr=156,
        notes='Summit before sunrise. Worth every step.' if w == 7 else None)

    # Priya: CrossFit, swim
    d = days(w, 0, 2, 4)
    act(PRIYA, d[0], 6, 'Workout', 'CrossFit WOD', 55, hr=150, photo='handstand-crossfit-box' if w % 3 == 0 else None,
        exercises=[{'name': 'Clean and Jerk', 'weight': 50 + w * 2.5, 'sets': 5, 'reps': 2}, {'name': 'Toes to Bar', 'weight': 0, 'sets': 4, 'reps': 12}])
    act(PRIYA, d[1], 6, 'Swim', 'Pool swim', 45, 2.0 + w * 0.1, hr=135, location='Vancouver Aquatic Centre')
    act(PRIYA, d[2], 18, 'WeightTraining', 'Strength', 50, hr=120, photo='overhead-squat-warehouse-gym' if w == 6 else None,
        exercises=[{'name': 'Front Squat', 'weight': 60 + w * 2.5, 'sets': 5, 'reps': 3}, {'name': 'Strict Press', 'weight': 35 + w, 'sets': 4, 'reps': 5}])

    # Liam: triathlete
    d = days(w, 1, 2, 4, 6)
    act(LIAM, d[0], 6, 'Swim', 'Open water swim' if w < 4 else 'Pool intervals', 40, 1.8 + w * 0.1, hr=140, location='English Bay' if w < 4 else None)
    act(LIAM, d[1], 17, 'Ride', 'Bike intervals', 70, 35, 260, anchor='jericho', hr=150)
    if w == 5:
        act(LIAM, date(2026, 10, 18), 8, 'Run', 'Seawall 10K', 47.8, 10.0, 30, anchor='seawall', hr=168, race_id=RACE_10K, best=run_best(10, 287),
            location='Stanley Park, Vancouver', notes='First race in RIVAL colours.', photo='a-small-group-of-diverse-athletes-2', mm=2)
    else:
        act(LIAM, d[2], 6, 'Run', 'Brick run', 35, 6.5, 30, anchor='kits', hr=158, best=run_best(6.5, 320))
    act(LIAM, d[3], 8, 'Ride', 'Long ride', 160 + w * 10, 80 + w * 5, 900, anchor='cypress', hr=140, photo='coastal-highway-triathlete-dusk-3' if w == 7 else None)

    # Kai: walks and rowing
    d = days(w, 0, 3, 6)
    act(KAI, d[0], 7, 'Rowing', 'Erg session', 35, 7.0 + w * 0.2, hr=145)
    act(KAI, d[1], 7, 'Walk', 'Morning walk with Miso', 55, 5.2, 40, anchor='kits', hr=105, photo='sunset-beach-group-walking' if w == 4 else None)
    act(KAI, d[2], 9, 'Hike', 'Deep Cove to Quarry Rock', 100, 4.0 + w * 0.3, 280 + w * 15, anchor='deepcove', hr=125, photo='coastal-cliff-hikers-group' if w in (2, 6) else None)

    # Reviewer: last 4 weeks of light activity so their own pages are not empty
    if w >= 4:
        d = days(w, 1, 4, 6)
        act(REV, d[0], 7, 'Run', 'Morning run', 32 + w, 5 + (w - 4) * 0.5, 30, anchor='falsecreek', hr=150, best=run_best(5 + (w - 4) * 0.5, 345))
        act(REV, d[1], 18, 'WeightTraining', 'Gym', 50, exercises=[{'name': 'Squat', 'weight': 70 + (w - 4) * 5, 'sets': 4, 'reps': 6}, {'name': 'Bench Press', 'weight': 50 + (w - 4) * 2.5, 'sets': 4, 'reps': 6}], hr=115)
        act(REV, d[2], 9, 'Walk', 'Seawall walk', 60, 5.5, 20, anchor='seawall', hr=100)

# Group run on Saturday 7 Nov, everyone tagged: shared activity for the reviewer to confirm.
grp = act(ALEX, date(2026, 11, 7), 7, 'Run', 'Saturday group run', 62, 11.2, 80, photo='2-3-trail-runners-moving-along-a', anchor='seawall', hr=148,
          notes='Great turnout this week. Coffee after at Lost Lagoon.', mm=30, best=run_best(11.2, 332))
grp['companions'] = 'Maya, Tess, Liam'

for a in ACTS:
    W(f"""insert into activities (id,user_id,provider,provider_activity_id,activity_type,name,name_locked,started_at,utc_offset_seconds,duration_seconds,distance_meters,elevation_meters,avg_heart_rate,avg_heartrate,photo_url,route_polyline,notes,exercises,race_id,is_race,location,companions,best_efforts,share_details,effort_confirmed,created_at)
values ({q(a['id'])},{q(a['user'])},'demo',{q(a['id'])},{q(a['type'])},{q(a['name'])},true,{q(a['started_at'].isoformat())},{a['off']},{a['dur']},{q(a['dist'])},{q(a['elev'])},{q(a['hr'])},{q(a['hr'])},{q(a['photo'])},{q(a['poly'])},{q(a['notes'])},{q(a['ex'])},{q(a['race_id'])},{q(bool(a['race_id']))},{q(a['location'])},{q(a.get('companions'))},{q(a['best'])},true,true,{q((a['started_at'] + timedelta(hours=1)).isoformat())}) on conflict (id) do nothing;""")
    if a['poly']:
        W(f"insert into activity_routes (activity_id,user_id,polyline) values ({q(a['id'])},{q(a['user'])},{q(a['poly'])}) on conflict do nothing;")
    if a['photo']:
        W(f"insert into activity_media (id,activity_id,media_url,media_type,position) values ({q(uid('media', a['id']))},{q(a['id'])},{q(a['photo'])},'photo',0) on conflict (id) do nothing;")

# Effort from the live scoring_config (same formula as lib/effort.ts).
W("""update activities a set
  effort_score = round(s.total), raw_effort_score = round(s.total)
from (
  select a2.id,
    (case when coalesce(c.distance_rate,0) > 0 and coalesce(a2.distance_meters,0) > 0
       then (a2.duration_seconds/60.0) * coalesce(c.distance_time_rate,0)
          + least(a2.distance_meters/1000.0, case when coalesce(c.min_pace,0) > 0 then (a2.duration_seconds/60.0)/c.min_pace else a2.distance_meters/1000.0 end) * c.distance_rate
       else (a2.duration_seconds/60.0) * coalesce(c.multiplier, 1.0) end)
    + least(coalesce(a2.elevation_meters,0), greatest(a2.duration_seconds/3600.0*2500, 1500)) * coalesce(c.elevation_rate,0) as total
  from activities a2 left join scoring_config c on c.activity_type = a2.activity_type
  where a2.provider = 'demo'
) s where a.id = s.id;""")

# ---- reactions and comments -------------------------------------------------
recent = [a for a in ACTS if a['started_at'] > NOW - timedelta(days=21)]
others = lambda u: [m for m in TEAM + [REV] if m != u]
for a in recent:
    r = random.Random(a['id'])
    n = r.randint(2, 6) + (2 if a['photo'] or a['race_id'] else 0)
    for u in r.sample(others(a['user']), min(n, 8)):
        if u == REV: continue  # the reviewer reacts for themselves
        emoji = 'inspired' if (a['photo'] or a['race_id'] or a['notes']) and r.random() < 0.45 else 'respect'
        ts = a['started_at'] + timedelta(hours=r.uniform(1.5, 20))
        if ts > NOW: ts = NOW - timedelta(minutes=r.randint(5, 90))
        W(f"insert into feed_reactions (id,league_id,target_type,target_id,user_id,emoji,created_at) values ({q(uid('rx', a['id'], u))},{q(HARBOUR)},'activity',{q(a['id'])},{q(u)},{q(emoji)},{q(ts.isoformat())}) on conflict do nothing;")

def comment(a, u, body, mins, reply=None, key=None):
    cid = uid('cm', a['id'], u, key or body[:20])
    ts = a['started_at'] + timedelta(minutes=mins)
    if ts > NOW: ts = NOW - timedelta(minutes=10)
    W(f"insert into feed_comments (id,league_id,target_type,target_id,user_id,body,created_at,reply_to_id) values ({q(cid)},{q(HARBOUR)},'activity',{q(a['id'])},{q(u)},{q(body)},{q(ts.isoformat())},{q(reply)}) on conflict (id) do nothing;")
    return cid

def find(user, name_part, latest=True):
    c = [a for a in ACTS if a['user'] == user and name_part in a['name']]
    return sorted(c, key=lambda a: a['started_at'])[-1 if latest else 0]

race = find(MAYA, 'Seawall 10K')
c1 = comment(race, ALEX, 'Under 45. Months of work paying off.', 180)
comment(race, MAYA, 'Could not have done it without the Saturday group runs.', 200, reply=c1)
comment(race, LIAM, 'Saw you pass me at 7 km. Well run.', 240)
lr = find(MAYA, 'Long run')
c2 = comment(lr, TESS, 'Half marathon distance in training. You are ready for December.', 300)
comment(lr, MAYA, 'Four weeks to go. Holding this pace is the plan.', 340, reply=c2)
dl = find(JORDAN, 'Deadlift day')
c3 = comment(dl, PRIYA, 'That bar was bending.', 90)
comment(dl, JORDAN, '200 is the target by Christmas.', 130, reply=c3)
gr = find(TESS, 'Baden-Powell') if any('Baden' in a['name'] and a['started_at'] > NOW - timedelta(days=10) for a in ACTS) else find(TESS, 'Grouse')
comment(gr, KAI, 'Those views. Taking the dog up there next weekend.', 150)
comment(grp, MAYA, 'Best group run so far. Same time next week?', 120)
comment(grp, LIAM, 'Count me in.', 140)
rv = [a for a in ACTS if a['user'] == REV]
if rv:
    last = sorted(rv, key=lambda a: a['started_at'])[-1]
    comment(last, MAYA, 'Good to see you out there. Join us Saturday.', 95)
    for u, e in [(MAYA, 'respect'), (ALEX, 'respect'), (TESS, 'inspired')]:
        W(f"insert into feed_reactions (id,league_id,target_type,target_id,user_id,emoji,created_at) values ({q(uid('rx', last['id'], u))},{q(HARBOUR)},'activity',{q(last['id'])},{q(u)},{q(e)},now() - interval '{random.randint(20, 300)} minutes') on conflict do nothing;")

# Reviewer tagged on the group run (pending: confirm from the inbox).
W(f"insert into activity_participants (id,activity_id,user_id,added_by,status,created_at) values ({q(uid('tag', grp['id'], REV))},{q(grp['id'])},{q(REV)},{q(ALEX)},'pending',now() - interval '3 hours') on conflict do nothing;")

# ---- chat ----------------------------------------------------------------
def msg(key, user, body, hours_ago, kind='text', reply=None, title=None, sched=None, loc=None, atype=None, pinned=False, expires=None):
    mid = uid('msg', key)
    W(f"insert into league_messages (id,league_id,user_id,kind,body,created_at,reply_to_id,title,scheduled_at,location,activity_type,pinned,expires_at) values ({q(mid)},{q(HARBOUR)},{q(user)},{q(kind)},{q(body)},now() - interval '{hours_ago} hours',{q(reply)},{q(title)},{q(sched)},{q(loc)},{q(atype)},{q(pinned)},{q(expires)}) on conflict (id) do nothing;")
    return mid
def react(mid, user, kind):
    W(f"insert into league_message_reactions (id,message_id,user_id,kind) values ({q(uid('mr', mid, user, kind))},{q(mid)},{q(user)},{q(kind)}) on conflict do nothing;")

board = msg('board1', ALEX, 'Saturday group runs start at 7:30 am through December. Meet at the Second Beach pool. All paces welcome.', 70, kind='board', title='Saturday group runs', pinned=True, expires='2026-12-31T23:59:00+00')
for u in (MAYA, TESS, LIAM, KAI): W(f"insert into feed_reactions (id,league_id,target_type,target_id,user_id,emoji) values ({q(uid('rxb', u))},{q(HARBOUR)},'board',{q(board)},{q(u)},'respect') on conflict do nothing;")
s1 = msg('sess-sat', ALEX, 'Saturday long run', 30, kind='session', sched='2026-11-14T15:30:00+00', loc='Second Beach, Stanley Park', atype='Run')
s2 = msg('sess-thu', MAYA, 'Track intervals', 20, kind='session', sched='2026-11-12T02:00:00+00', loc='Point Grey track', atype='Run')
s3 = msg('sess-swim', LIAM, 'Sunday swim', 8, kind='session', sched='2026-11-15T17:00:00+00', loc='Vancouver Aquatic Centre', atype='Swim')
for sid, us in [(s1, [ALEX, MAYA, TESS, LIAM, KAI]), (s2, [MAYA, TESS, JORDAN]), (s3, [LIAM, PRIYA])]:
    for u in us: W(f"insert into league_session_rsvps (id,message_id,user_id) values ({q(uid('rsvp', sid, u))},{q(sid)},{q(u)}) on conflict do nothing;")

chat = [
    ('c1', MAYA, 'Seawall 10K done. 44:12. Thank you all for the support this block.', 560),
    ('c2', ALEX, 'Massive. That was a 2 minute PB.', 559, 'c1'),
    ('c3', LIAM, 'Signed up for the Harbour Half. Who else is in?', 300),
    ('c4', TESS, 'In. Going for under 1:50.', 298, 'c3'),
    ('c5', KAI, 'I will walk part of it and cheer for the rest.', 296, 'c3'),
    ('c6', JORDAN, 'New deadlift best this morning. 202.5 kg.', 120),
    ('c7', PRIYA, 'Strongest in the club by a mile.', 119, 'c6'),
    ('c8', SAM, 'Anyone want to ride Cypress on Sunday? Rolling at 8 from Dundarave.', 48),
    ('c9', LIAM, 'Yes. I need the hill work before the fondo.', 47, 'c8'),
    ('c10', MAYA, 'Track session moved to Wednesday this week. Same time.', 26),
    ('c11', TESS, 'Grouse was fogged in this morning but the sunrise above it was unreal.', 14),
    ('c12', ALEX, 'Big week for the team challenge. Thank you, everyone.', 6),
    ('c13', KAI, 'Saturday run is my first 10 km with the group. Go easy on me.', 3),
    ('c14', MAYA, 'We will stay together the whole way.', 2.5, 'c13'),
]
ids = {}
for row in chat:
    key, u, body, h = row[:4]; rep = ids.get(row[4]) if len(row) > 4 else None
    ids[key] = msg(key, u, body, h, reply=rep)
for key, us in [('c1', [(ALEX, '🔥'), (TESS, '❤️'), (LIAM, '👏'), (KAI, '🙌')]), ('c6', [(MAYA, '💪'), (SAM, '🔥'), (ALEX, '💪')]),
                ('c12', [(MAYA, '🙌'), (TESS, '⚡'), (LIAM, '🔥')]), ('c13', [(TESS, '❤️'), (ALEX, '👏')]), ('c11', [(KAI, '❤️')])]:
    for u, k in us: react(ids[key], u, k)

# ---- achievements and encouragement --------------------------------------
for u, achs in [(MAYA, ['first_run', 'activities_10', 'activities_25', 'distance_100', 'distance_500', 'streak_4', 'streak_8']),
                (TESS, ['first_run', 'first_hike', 'activities_10', 'elevation_1000', 'elevation_8849', 'distance_100']),
                (LIAM, ['first_run', 'first_ride', 'first_swim', 'activities_10', 'activities_25', 'distance_500']),
                (JORDAN, ['first_activity', 'activities_10', 'activities_25', 'streak_4']),
                (PRIYA, ['first_activity', 'first_swim', 'activities_10', 'streak_4']),
                (SAM, ['first_ride', 'activities_10', 'distance_500', 'elevation_1000', 'elevation_8849']),
                (KAI, ['first_activity', 'first_hike', 'activities_10']),
                (REV, ['first_run', 'first_activity', 'activities_10'])]:
    for i, aid in enumerate(achs):
        W(f"insert into user_achievements (id,user_id,achievement_id,earned_at) values ({q(uid('ach', u, aid))},{q(u)},{q(aid)},now() - interval '{(len(achs) - i) * 6} days') on conflict (user_id,achievement_id) do nothing;")
W(f"insert into encouragements (id,from_user_id,to_user_id,message,created_at) values ({q(uid('enc', 'rev'))},{q(MAYA)},{q(REV)},'Welcome to Harbour Run Club. See you on Saturday.',now() - interval '26 hours') on conflict (id) do nothing;")

# One-on-one challenge in the team.
W(f"insert into league_challenges (id,league_id,challenger_id,opponent_id,metric,start_date,end_date,status) values ({q(uid('ch', 'maya-liam'))},{q(HARBOUR)},{q(MAYA)},{q(LIAM)},'distance','2026-11-09','2026-11-15','active') on conflict (id) do nothing;")

W('commit;')
open(__file__.replace('.py', '.sql'), 'w').write('\n'.join(out))
print(len(ACTS), 'activities;', sum(1 for a in ACTS if a['photo']), 'photos;', sum(1 for a in ACTS if a['poly']), 'routes;', len(out), 'statements')
