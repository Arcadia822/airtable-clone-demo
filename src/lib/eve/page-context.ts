export type AssistantPageContext = {
  base?: { id: string; name?: string };
  table?: { id: string; name?: string };
  form?: { id: string; name?: string };
  view?: { id: string; name?: string };
};

type AssistantScopeEntity = {
  id: string;
  name: string;
};

export type AssistantClientContext = {
  activeScope: {
    base?: AssistantScopeEntity;
    table?: AssistantScopeEntity;
    form?: AssistantScopeEntity;
    view?: AssistantScopeEntity;
  };
  kind: "workspace-page-context";
};

export function buildAssistantClientContext(
  context?: AssistantPageContext,
): AssistantClientContext | undefined {
  if (!context) return undefined;

  const activeScope = {
    ...(context.base
      ? { base: scopeEntity(context.base, "Untitled base") }
      : {}),
    ...(context.table
      ? { table: scopeEntity(context.table, "Untitled table") }
      : {}),
    ...(context.form
      ? { form: scopeEntity(context.form, "Untitled form") }
      : {}),
    ...(context.view
      ? { view: scopeEntity(context.view, "Untitled view") }
      : {}),
  };

  if (Object.keys(activeScope).length === 0) return undefined;

  return {
    kind: "workspace-page-context",
    activeScope,
  };
}

function scopeEntity(
  entity: { id: string; name?: string },
  fallbackName: string,
): AssistantScopeEntity {
  return {
    id: entity.id,
    name: entity.name?.trim() || fallbackName,
  };
}
