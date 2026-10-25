import BoardLayout from "../../components/BoardLayout";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <BoardLayout>{children}</BoardLayout>;
}
