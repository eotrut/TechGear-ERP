import { ReportLoading } from "@/features/reports/components/report-loading";

/** Two rows of headline tiles, then the performance chart: the dashboard's own shape. */
export default function Loading() {
  return <ReportLoading tiles={8} />;
}
