/// <reference types="vite/client" />

declare module "*.jpeg" {
  const src: string;
  export default src;
}

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "uuid" {
  export function v4(): string;
}
