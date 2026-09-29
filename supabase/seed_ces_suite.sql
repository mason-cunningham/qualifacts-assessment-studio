-- ════════════════════════════════════════════════════════════════════════════
-- Client Engagement Suite (CES) — one product whose feature sets are the CES
-- capabilities currently stored as separate library rows (Broadcast Messaging,
-- Client Billing Module, eSignatures, …). Each feature keeps that row's name,
-- description, top 3 benefits and screenshot.
--
-- Requires 006_product_features.sql (the "features" column). Safe to re-run:
-- it updates the existing "Client Engagement Suite" row instead of adding another.
-- The individual CES rows are left as they are (already inactive).
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_features  jsonb;
  v_cta_label text;
  v_cta_url   text;
begin
  -- One feature per CES library row; ids are stable ("f_client_billing_module")
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id',       'f_' || btrim(regexp_replace(lower(p.name), '[^a-z0-9]+', '_', 'g'), '_'),
           'name',     p.name,
           'solves',   nullif(btrim(p.why_it_matters), ''),
           'summary',  nullif(btrim(p.what_it_does), ''),
           'benefits', b.top3,
           'mediaUrl', nullif(btrim(p.image_url), ''),
           'mediaAlt', case when nullif(btrim(p.image_url), '') is not null then p.name || ' in the Qualifacts client portal' end
         )) order by p.name), '[]'::jsonb)
    into v_features
    from public."q-quiz-products" p
    left join lateral (
      select coalesce(jsonb_agg(t.b order by t.i), '[]'::jsonb) as top3
        from jsonb_array_elements_text(p.benefits) with ordinality as t(b, i)
       where t.i <= 3 and btrim(t.b) <> ''
    ) b on true
   where p.product_line = 'CES'
     and p.name <> 'Client Engagement Suite';

  -- Use the button most CES features already share (e.g. "Submit QCC Case to Enable")
  select cta_label, cta_url into v_cta_label, v_cta_url
    from public."q-quiz-products"
   where product_line = 'CES' and name <> 'Client Engagement Suite' and nullif(btrim(cta_url), '') is not null
   group by cta_label, cta_url
   order by count(*) desc
   limit 1;

  if exists (select 1 from public."q-quiz-products" where name = 'Client Engagement Suite') then
    update public."q-quiz-products"
       set features   = v_features,
           cta_label  = coalesce(cta_label, v_cta_label),
           cta_url    = coalesce(cta_url, v_cta_url),
           is_active  = true
     where name = 'Client Engagement Suite';
  else
    insert into public."q-quiz-products"
      (name, product_line, category, tagline, what_it_does, why_it_matters, benefits, cta_label, cta_url, is_active, features)
    values (
      'Client Engagement Suite',
      'CES',
      'Client Engagement',
      'A secure client portal that keeps people engaged between visits',
      'The Client Engagement Suite gives clients one secure portal to complete forms, sign documents, pay balances, view their records and manage their information, while staff message clients and track engagement from the EHR.',
      'Every task a client can finish on their own is one less phone call, paper form or manual entry for your team, and a more connected experience for the people you serve.',
      '["Clients complete forms, signatures and payments on their own", "Fewer phone calls, paper forms and manual data entry", "Staff reach every client with the right message", "Visibility into client engagement and communication"]'::jsonb,
      v_cta_label,
      v_cta_url,
      true,
      v_features
    );
  end if;

  raise notice 'Client Engagement Suite now has % feature sets', jsonb_array_length(v_features);
end $$;

-- Check the result:
-- select name, jsonb_array_length(features) as features, features from "q-quiz-products" where name = 'Client Engagement Suite';
