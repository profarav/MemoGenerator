// Allow CSS side-effect imports (Next.js handles these at build time)
declare module '*.css' {
  const content: Record<string, string>
  export default content
}
