import EnvironmentDetail from "@/components/EnvironmentDetail";

// Required for static export with dynamic routes
export function generateStaticParams() {
  return [{ envId: "demo" }];
}

export default function EnvironmentPage() {
  return <EnvironmentDetail />;
}
