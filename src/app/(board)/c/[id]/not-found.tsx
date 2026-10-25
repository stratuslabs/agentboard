"use client";

import { useParams, useRouter } from "next/navigation";
import { SearchX } from "lucide-react";
import { Button, EmptyState } from "../../../../components/ui";

export default function CardNotFound() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const body = /^[0-9]+$/.test(id ?? "")
    ? <>There&apos;s no card #{id}. It may have been deleted.</>
    : <>This link doesn&apos;t point to a card.</>;
  return (
    <div className="flex flex-1 items-center justify-center pb-20">
      <EmptyState
        icon={<SearchX />}
        title="Card not found"
        body={body}
        action={<Button variant="primary" onClick={() => router.push("/")}>Go home</Button>}
      />
    </div>
  );
}
