import { FilterOperatorEnum } from "@hubspot/api-client/lib/codegen/crm/companies/index.js";
import type {
  CompanyProperties,
  ContactProperties,
  DealProperties,
} from "@/hubspot";
import { hubspot as hubspot_env } from "$/env";
import { crm, hubspot } from "$/kit/hubspot";

const getHubspotContact = async (email: string) =>
  hubspot.crm.contacts.searchApi
    .doSearch({
      query: email,
      limit: 1,
      filterGroups: [],
      after: "0",
      sorts: [],
      properties: [],
    })
    .then((res) => res.results.at(0));

const get_hubspot_company = async (reg_id: string) =>
  hubspot.crm.companies.searchApi
    .doSearch({
      limit: 1,
      filterGroups: [
        {
          filters: [
            {
              propertyName: "angel_giving_registration_number",
              operator: FilterOperatorEnum.Eq,
              value: reg_id,
            },
          ],
        },
      ],
      after: "0",
      sorts: [],
      properties: [],
    })
    .then((res) => res.results.at(0));

export const update_or_create_contact = (
  email: string,
  properties: ContactProperties
) =>
  crm("contact sync", async () => {
    const existing = await getHubspotContact(email);
    if (!existing) {
      return hubspot.crm.contacts.basicApi.create({
        properties,
      });
    }
    return hubspot.crm.contacts.basicApi.update(existing.id, { properties });
  });

export const update_or_create_company = (
  reg_id: string,
  properties: CompanyProperties
) =>
  crm("company sync", async () => {
    const existing = await get_hubspot_company(reg_id);
    if (!existing) {
      return hubspot.crm.companies.basicApi.create({ properties });
    }
    return hubspot.crm.companies.basicApi.update(existing.id, { properties });
  });

export const create_deal = async (org_name: string) => {
  const props: DealProperties = {
    dealname: org_name,
    pipeline: "default",
    dealstage: hubspot_env.deal_stage_id,
    hubspot_owner_id: hubspot_env.owner_id,
  };
  return crm("deal", () =>
    hubspot.crm.deals.basicApi.create({
      properties: props,
    })
  );
};
