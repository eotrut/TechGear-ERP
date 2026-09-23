import { db } from "@/lib/db";

/**
 * Warehouse reads, with the two numbers that make the list worth looking at:
 * how many variants sit there and how many units in total.
 */

export type WarehouseRow = {
  id: string;
  code: string;
  name: string;
  city: string | null;
  province: string | null;
  isDefault: boolean;
  isActive: boolean;
  skuCount: number;
  unitCount: number;
  movementCount: number;
};

export async function listWarehouses(): Promise<WarehouseRow[]> {
  const [warehouses, levels, movements] = await Promise.all([
    db.warehouse.findMany({
      where: { deletedAt: null },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }],
      select: {
        id: true,
        code: true,
        name: true,
        isDefault: true,
        isActive: true,
        address: { select: { city: true, province: true } },
      },
    }),
    db.stockLevel.groupBy({
      by: ["warehouseId"],
      _sum: { onHand: true },
      _count: { _all: true },
    }),
    db.stockMovement.groupBy({ by: ["warehouseId"], _count: { _all: true } }),
  ]);

  const stock = new Map(levels.map((row) => [row.warehouseId, row]));
  const moved = new Map(movements.map((row) => [row.warehouseId, row._count._all]));

  return warehouses.map((warehouse) => ({
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    city: warehouse.address?.city ?? null,
    province: warehouse.address?.province ?? null,
    isDefault: warehouse.isDefault,
    isActive: warehouse.isActive,
    skuCount: stock.get(warehouse.id)?._count._all ?? 0,
    unitCount: stock.get(warehouse.id)?._sum.onHand ?? 0,
    movementCount: moved.get(warehouse.id) ?? 0,
  }));
}
