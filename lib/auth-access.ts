import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, ownerAc, adminAc, memberAc } from 'better-auth/plugins/organization/access';

export const ac = createAccessControl(defaultStatements);
export const roles = {
  owner: ac.newRole(ownerAc.statements),
  admin: ac.newRole(adminAc.statements),
  member: ac.newRole(memberAc.statements),
  viewer: ac.newRole({ organization: [], member: [], invitation: [], team: [], ac: [] }),
};
