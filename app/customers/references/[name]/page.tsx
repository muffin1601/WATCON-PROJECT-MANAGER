import { notFound } from "next/navigation";
import Link from "next/link";
import { BackLink } from "../../../../components/BackLink/BackLink";
import { Card, CardBody, CardHeader, CardTitle } from "../../../../components/Card/Card";
import { StatsGrid } from "../../../../components/StatsGrid/StatsGrid";
import { StatCard } from "../../../../components/StatCard/StatCard";
import { Table, TableWrap, Td, Th, EmptyState } from "../../../../components/Table/Table";
import { Button } from "../../../../components/Button/Button";
import { Chip } from "../../../../components/Chip/Chip";
import { getReferenceDetail } from "../../../../services/customerService";
import { getGstRatePct } from "../../../../lib/settings";
import { PROJECT_STATUS_LABEL } from "../../../../modules/projects/data";
import { inr, dfmt } from "../../../../lib/format";
import { getCurrentUser } from "../../../../lib/auth";
import { can } from "../../../../modules/auth/permissions";
import { NoPermission } from "../../../../components/Auth/NoPermission";

export const dynamic = "force-dynamic";

// Reference detail — everything one referrer has brought in: the customers
// they introduced, the quotations sent through them, and the resulting
// projects with money in and money still due.
export default async function ReferenceDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const currentUser = await getCurrentUser();
  if (!can(currentUser, "customers", "view")) return <NoPermission module="customers" />;

  const { name } = await params;
  const decoded = decodeURIComponent(name);
  const data = await getReferenceDetail(decoded, await getGstRatePct());
  if (!data) notFound();
  const s = data.summary;

  return (
    <>
      <BackLink href="/customers">Customers &amp; references</BackLink>
      <h2 style={{ fontSize: 22, fontWeight: 800 }}>
        {data.name} <Chip tone="teal">Reference</Chip>
      </h2>

      <div style={{ marginTop: 16 }}>
        <StatsGrid>
          <StatCard label="Customers referred" value={String(s.customerCount)} highlight />
          <StatCard label="Quotations" value={`${s.quotationCount} (${s.openQuotationCount} open)`} />
          <StatCard label="Quoted value" value={inr(s.quotedValue)} />
          <StatCard label="Projects" value={String(s.projectCount)} />
          <StatCard label="Contract value" value={inr(s.contract)} />
          <StatCard label="Received" value={inr(s.received)} tone="pos" />
          <StatCard label="Payment due" value={inr(s.due)} tone={s.due > 0 ? "neg" : "pos"} />
        </StatsGrid>
      </div>

      <Card style={{ marginTop: 18 }}>
        <CardHeader>
          <CardTitle>Quotations sent through {data.name}</CardTitle>
        </CardHeader>
        <CardBody>
          {data.quotations.length === 0 ? (
            <EmptyState>No quotations through this reference yet.</EmptyState>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Ref</Th>
                    <Th>Date</Th>
                    <Th>Customer</Th>
                    <Th>Project</Th>
                    <Th align="r">Value</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {data.quotations.map((q) => (
                    <tr key={q.id}>
                      <Td>
                        <b>{q.ref}</b>
                      </Td>
                      <Td>{dfmt(q.date)}</Td>
                      <Td>{q.client}</Td>
                      <Td>{q.title}</Td>
                      <Td align="r">{inr(q.grandTotal)}</Td>
                      <Td>
                        <Chip tone={q.status === "CONVERTED" || q.status === "ACCEPTED" ? "green" : q.status === "SENT" ? "teal" : "grey"}>
                          {q.status}
                        </Chip>
                      </Td>
                      <Td>
                        <Link href={`/quotations/${q.id}`}>
                          <Button size="sm">Open</Button>
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </CardBody>
      </Card>

      <Card style={{ marginTop: 18 }}>
        <CardHeader>
          <CardTitle>Projects through {data.name}</CardTitle>
        </CardHeader>
        <CardBody>
          {data.projects.length === 0 ? (
            <EmptyState>No projects through this reference yet.</EmptyState>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Project</Th>
                    <Th>Customer</Th>
                    <Th>Site</Th>
                    <Th>Status</Th>
                    <Th align="r">Contract</Th>
                    <Th align="r">Goods sent</Th>
                    <Th align="r">Received</Th>
                    <Th align="r">Due</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {data.projects.map((p) => (
                    <tr key={p.id}>
                      <Td>
                        <b>{p.name}</b>
                      </Td>
                      <Td>{p.client}</Td>
                      <Td>{p.site || "—"}</Td>
                      <Td>
                        <Chip tone={p.status === "COMPLETED" ? "green" : p.status === "ON_HOLD" ? "gold" : "grey"}>
                          {PROJECT_STATUS_LABEL[p.status] ?? p.status}
                        </Chip>
                      </Td>
                      <Td align="r">{inr(p.contract)}</Td>
                      <Td align="r">{inr(p.sent)}</Td>
                      <Td align="r" style={{ color: "var(--ok)" }}>
                        {inr(p.received)}
                      </Td>
                      <Td align="r" style={{ color: p.balance > 0 ? "var(--danger)" : undefined }}>
                        {inr(p.balance)}
                      </Td>
                      <Td>
                        <Link href={`/projects/${p.id}`}>
                          <Button size="sm">Open</Button>
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </CardBody>
      </Card>

      <Card style={{ marginTop: 18 }}>
        <CardHeader>
          <CardTitle>Customers referred by {data.name}</CardTitle>
        </CardHeader>
        <CardBody>
          {data.customers.length === 0 ? (
            <EmptyState>No customers carry this reference yet.</EmptyState>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th>Phone</Th>
                    <Th>Sales person</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {data.customers.map((c) => (
                    <tr key={c.id}>
                      <Td>
                        <b>{c.name}</b>
                      </Td>
                      <Td>{c.phone || "—"}</Td>
                      <Td>{c.salesPerson || "—"}</Td>
                      <Td>
                        <Link href={`/customers/${c.id}`}>
                          <Button size="sm">Open</Button>
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </CardBody>
      </Card>
    </>
  );
}
