-- verification fixture: one published nonprofit for the donate flows.
-- idempotent; registration_number 'VERIFY0001' marks it.
insert into npos (registration_number, name, endow_designation, hq_country, overview_pt, tagline, published, active)
select 'VERIFY0001', 'Verify Test Nonprofit', 'Charity', 'United States',
       'Fixture nonprofit for verify-platform.', 'Fixture nonprofit used by the verify skill', true, true
where not exists (select 1 from npos where registration_number = 'VERIFY0001');
-- logo so the organization form's required logo is already filled
update npos set logo = 'https://example.com/verify-logo.png'
where registration_number = 'VERIFY0001' and logo is null;
-- unpublished nonprofit that already has an org slug
insert into npos (
  registration_number, name, endow_designation, hq_country, overview_pt,
  tagline, published, active, slug
)
select 'VERIFY-0002', 'Verify Slug Fixture', 'Charity', 'United States',
       'Fixture nonprofit that already has an org slug.',
       'Unused by the public list', false, true, 'verify-slug-fixture'
where not exists (select 1 from npos where registration_number = 'VERIFY-0002');
-- npo admin for the organization page. email is verified. the published
-- nonprofit starts without a slug so the flow can set one.
insert into "user" (
  id, name, email, email_verified, first_name, last_name, referral_code,
  created_at, updated_at
)
select 'verify-npo-admin', 'Verify Npo Admin', 'verify-npo-admin@example.com',
       true, 'Verify', 'Admin', 'verify-npo-admin', now(), now()
where not exists (select 1 from "user" where id = 'verify-npo-admin');
insert into account (
  id, account_id, provider_id, user_id, password, created_at, updated_at
)
select 'verify-npo-admin-credential', 'verify-npo-admin', 'credential',
       'verify-npo-admin',
       '71f34cdc377803f9b28e619de3b5abc6:fd6f14b088f21a6b05aa1823b4029444430a68b4d214a4b62f4dc21baf26cb34f52fd41c3ab9b7f724f78db1699714320b46a9a702eaae4af3bc0ad2ac184ca8',
       now(), now()
where not exists (
  select 1 from account where id = 'verify-npo-admin-credential'
);
insert into user_npo_memberships (user_id, npo_id)
select 'verify-npo-admin', n.id
from npos n
where n.registration_number = 'VERIFY0001'
  and not exists (
    select 1 from user_npo_memberships m
    where m.user_id = 'verify-npo-admin' and m.npo_id = n.id
  );
-- usd rates for the currency picker (api/currencies); fixed fixture values
insert into currency_rates (base_currency, rates, updated_at)
values ('USD', '{"USD":1,"EUR":0.92,"GBP":0.79,"PHP":56.5,"AUD":1.52,"CAD":1.37}', now())
on conflict (base_currency) do nothing;

-- campaigns are a second published nonprofit. VERIFY0001 stays without a slug so
-- the organization-slug flow can set verify-test. this slug is a different word
-- so the two do not collide.
insert into npos (
  registration_number, name, endow_designation, hq_country, overview_pt,
  tagline, published, active, slug, image, logo
)
select 'VERIFY0003', 'Verify Campaign Nonprofit', 'Charity', 'United States',
       'Fixture nonprofit for campaign verify flows.',
       'Fixture nonprofit used by the campaign drives',
       true, true, 'verify-campaign', '/logo.png', '/logo.png'
where not exists (select 1 from npos where registration_number = 'VERIFY0003');
-- the agents-quote drive's increments: stored out of order with one bad value.
-- no browser drive renders this nonprofit's own donate form.
update npos set increments = '[{"value":"100","label":"Fixture: plant a grove"},{"value":"25","label":"Fixture: feed a child"},{"value":"abc","label":"Fixture: not a number"}]'::jsonb
where registration_number = 'VERIFY0003' and increments is null;

-- campaign npo admin. same account fixture-accounts.mjs exports as ADMIN, so
-- seed-member.mjs hashes the same password and does not replace this one.
-- email_verified so sign-in does not mail a link.
-- the id is a uuid: the listing page accepts a creator id that is an email, a uuid, or a number.
insert into "user" (id, name, email, email_verified, first_name, last_name, updated_at)
values (
  'a0000000-0000-4000-8000-0000000000aa', 'Verify Admin', 'verify-admin@example.com', true,
  'Verify', 'Admin', now()
);
insert into account (id, account_id, provider_id, user_id, password, updated_at)
values (
  'verify-admin-credential', 'a0000000-0000-4000-8000-0000000000aa', 'credential', 'a0000000-0000-4000-8000-0000000000aa',
  '4e55eae59826dde5791d243067c53fd7:ed15c9014d7f3e04fde4282979c14d0c422115823f5c515d683951701f84f98b842a317b75f9857b76cdf2c3ab96279787ee934d741b57964f8a74d0a55c2a11',
  now()
);
insert into user_npo_memberships (user_id, npo_id)
select 'a0000000-0000-4000-8000-0000000000aa', id from npos where registration_number = 'VERIFY0003';

-- an existing npo-owned fund. the campaigns list shows it as a campaign.
insert into funds (
  id, name, slug, description_pt, banner, logo, featured, active,
  expiration, npo_owner, creator_id
)
select
  'f0000000-0000-4000-8000-000000000001',
  'Harbor Listing',
  'harbor-listing',
  '[{"_key":"h1","_type":"block","style":"normal","markDefs":[],"children":[{"_key":"h2","_type":"span","text":"An existing listing for the harbor.","marks":[]}]}]',
  '/logo.png',
  '/logo.png',
  true,
  true,
  '9999-12-31T23:59:59Z',
  id,
  'a0000000-0000-4000-8000-0000000000aa'
from npos where registration_number = 'VERIFY0003';
insert into fund_members (fund_id, npo_id)
select 'f0000000-0000-4000-8000-000000000001', id
from npos where registration_number = 'VERIFY0003';

-- live campaign the public page and the donate flow use. increments are +100 USD.
insert into campaigns (
  id, owner_npo_id, creator_id, name, slug, description_pt, banner, logo,
  status, published_at, ends_at, donate_methods, donate_frequencies,
  increments, target_number, videos
)
select
  'c0ffee00-0000-4000-8000-000000000001',
  id,
  'a0000000-0000-4000-8000-0000000000aa',
  'Winter Drive',
  'winter',
  '[{"_key":"w1","_type":"block","style":"normal","markDefs":[],"children":[{"_key":"w2","_type":"span","text":"A winter story for the seeded campaign.","marks":[]}]}]',
  '/logo.png',
  '/logo.png',
  'live',
  now(),
  '2027-12-31T23:59:59.999Z',
  array['stripe'],
  array['one-time','monthly'],
  '[{"value":"100","label":""}]'::jsonb,
  5000,
  array['https://www.youtube.com/watch?v=aqz-KE-bpKQ']::text[]
from npos where registration_number = 'VERIFY0003'
  and not exists (
    select 1 from campaigns
    where id = 'c0ffee00-0000-4000-8000-000000000001'
  );
-- a database that already has Winter Drive keeps the old row. the insert
-- above does not rewrite it, so an empty videos array still needs this.
update campaigns
set videos = array['https://www.youtube.com/watch?v=aqz-KE-bpKQ']::text[]
where id = 'c0ffee00-0000-4000-8000-000000000001'
  and videos = '{}';
insert into campaign_members (campaign_id, npo_id)
select 'c0ffee00-0000-4000-8000-000000000001', id
from npos where registration_number = 'VERIFY0003';

-- draft: the public page must 404 it.
insert into campaigns (
  id, owner_npo_id, creator_id, name, slug, description_pt, status
)
select
  'c0ffee00-0000-4000-8000-000000000002',
  id,
  'a0000000-0000-4000-8000-0000000000aa',
  'Hidden Draft',
  'draft-hidden',
  '[]',
  'draft'
from npos where registration_number = 'VERIFY0003';
insert into campaign_members (campaign_id, npo_id)
select 'c0ffee00-0000-4000-8000-000000000002', id
from npos where registration_number = 'VERIFY0003';

insert into donations (
  id, upusd, status, amount_base, amount_tip, amount_fee_allowance,
  currency, frequency, source, via, campaign_id
) values
(
  'd0000000-0000-4000-8000-000000000001', 25, 'settled', 25, 0, 0,
  'USD', 'one-time', 'bg-marketplace', 'stripe',
  'c0ffee00-0000-4000-8000-000000000001'
),
(
  'd0000000-0000-4000-8000-000000000002', 10, 'settled', 10, 0, 0,
  'USD', 'one-time', 'bg-marketplace', 'stripe',
  null
);
insert into donation_donors (donation_id, email, name)
select 'd0000000-0000-4000-8000-000000000001', 'campaign-donor@example.com', 'Campaign Donor'
where not exists (
  select 1 from donation_donors
  where donation_id = 'd0000000-0000-4000-8000-000000000001'
);
-- raised is the settled dist net, not the donation row. without this the
-- page counts the donor and shows $0.
insert into dists (
  id, donation_id, status, date_created, to_id, amount_denom, amount, amount_usd, net
)
select
  'dist-verify-campaign',
  'd0000000-0000-4000-8000-000000000001',
  'settled',
  now(),
  id,
  'USD',
  25, 25, 25
from npos
where registration_number = 'VERIFY0003'
  and not exists (select 1 from dists where id = 'dist-verify-campaign');
insert into donation_messages (id, donation_id, npo_id, donor_name, donor_message, date, amount)
select
  'verify-msg-campaign',
  'd0000000-0000-4000-8000-000000000001',
  id::text,
  'Campaign Donor',
  'Seeded campaign thanks',
  now(),
  25
from npos where registration_number = 'VERIFY0003';
insert into donation_messages (id, donation_id, npo_id, donor_name, donor_message, date, amount)
select
  'verify-msg-profile',
  'd0000000-0000-4000-8000-000000000002',
  id::text,
  'Profile Donor',
  'Profile only gift note',
  now() - interval '1 minute',
  10
from npos where registration_number = 'VERIFY0003';

-- before the select: launch.sh reads the last printed line as VERIFY0001's id.
\ir seed-supporter-fundraiser.sql

select id from npos where registration_number = 'VERIFY0001';
