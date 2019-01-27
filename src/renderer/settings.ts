export const NAMESPACE = 'gitamine';

export enum Field {
  Name = 'name',
  Email = 'email'
}

export function getKey(field: Field) {
  return `${NAMESPACE}.${field}`;
}