import { ReviewSession } from "@/components/ReviewSession";

type ReviewPageProps = {
  params: Promise<{ id: string }>;
};

export default async function ReviewPage({ params }: ReviewPageProps) {
  const { id } = await params;
  return <ReviewSession key={id} id={id} />;
}
