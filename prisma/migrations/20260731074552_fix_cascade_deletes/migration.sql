-- DropForeignKey
ALTER TABLE "challan_items" DROP CONSTRAINT "challan_items_itemId_fkey";

-- DropForeignKey
ALTER TABLE "purchase_orders" DROP CONSTRAINT "purchase_orders_projectId_fkey";

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challan_items" ADD CONSTRAINT "challan_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "po_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
