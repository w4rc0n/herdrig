/** A sole public catalog entry is unambiguous even when OpenRig has no default. */
export function effectiveScopeProject(explicit,selected,catalog) {
  if(explicit!=null)return explicit;
  if(selected!=null)return selected;
  const projects=Array.isArray(catalog?.projects)?catalog.projects:[];
  return projects.length===1&&typeof projects[0]?.id==='string'&&projects[0].id?projects[0].id:null;
}
