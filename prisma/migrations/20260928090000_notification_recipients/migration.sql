-- Notifications become one row per recipient, so reading one is personal:
-- a broadcast row with a single readAt let the first manager to open it mark
-- it read for every other manager.

-- Fan each existing broadcast out to the active users of its role ...
INSERT INTO "Notification" ("id", "userId", "targetRole", "type", "title", "body", "link", "readAt", "createdAt")
SELECT n."id" || '_' || u."id", u."id", n."targetRole", n."type", n."title", n."body", n."link", n."readAt", n."createdAt"
FROM "Notification" n
JOIN "User" u ON u."role" = n."targetRole" AND u."isActive"
WHERE n."userId" IS NULL;

-- ... then drop the broadcasts, and anything addressed to nobody.
DELETE FROM "Notification" WHERE "userId" IS NULL;

-- DropIndex
DROP INDEX "Notification_targetRole_createdAt_idx";

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dedupeKey" TEXT,
ALTER COLUMN "userId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");
