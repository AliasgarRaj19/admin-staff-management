import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const globalForPrisma = globalThis;

function assertDatabaseUrl() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL must be set for database access.");
  }
  return connectionString;
}

function toDate(value) {
  return value ? new Date(value) : null;
}

function mapStaffAccount(row) {
  if (!row) return null;
  return {
    ...row,
    invitedAt: toDate(row.invitedAt),
    registeredAt: toDate(row.registeredAt),
    activatedAt: toDate(row.activatedAt),
    blockedAt: toDate(row.blockedAt),
    removedAt: toDate(row.removedAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function mapInvitation(row) {
  if (!row) return null;
  return {
    ...row,
    expiresAt: toDate(row.expiresAt),
    acceptedAt: toDate(row.acceptedAt),
    revokedAt: toDate(row.revokedAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function mapReset(row) {
  if (!row) return null;
  return {
    ...row,
    expiresAt: toDate(row.expiresAt),
    consumedAt: toDate(row.consumedAt),
    revokedAt: toDate(row.revokedAt),
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function mapAudit(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata,
    createdAt: toDate(row.createdAt),
  };
}

function mapSimpleCountRow(row) {
  return Number(row?.count ?? 0);
}

function withGeneratedId(data) {
  return { id: randomUUID(), ...data };
}

function mapPermission(row) {
  if (!row) return null;
  return {
    ...row,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

function buildWhere(where = {}, params = [], alias = "t") {
  const clauses = [];
  const add = (sql, value) => {
    params.push(value);
    clauses.push(sql.replace("?", `$${params.length}`));
  };

  for (const [key, value] of Object.entries(where)) {
    if (key === "OR" && Array.isArray(value)) {
      const orClauses = value.map((entry) => `(${buildWhere(entry, params, alias).sql})`).filter(Boolean);
      if (orClauses.length) clauses.push(`(${orClauses.join(" OR ")})`);
      continue;
    }
    if (value && typeof value === "object" && "startsWith" in value) {
      add(`"${key}" LIKE ?`, `${value.startsWith}%`);
      continue;
    }
    if (value === null) {
      clauses.push(`"${key}" IS NULL`);
      continue;
    }
    add(`"${key}" = ?`, value);
  }
  return { sql: clauses.join(" AND "), params };
}

function createApi(client) {
  const queryOne = async (text, params = []) => {
    const { rows } = await client.query(text, params);
    return rows[0] ?? null;
  };
  const queryAll = async (text, params = []) => {
    const { rows } = await client.query(text, params);
    return rows;
  };

  const staffAccount = {
    async findUnique({ where }) {
      if (where.email) {
        return mapStaffAccount(await queryOne(`SELECT * FROM "StaffAccount" WHERE "email" = $1 LIMIT 1`, [where.email]));
      }
      if (where.id) {
        return mapStaffAccount(await queryOne(`SELECT * FROM "StaffAccount" WHERE "id" = $1 LIMIT 1`, [where.id]));
      }
      return null;
    },
    async findMany({ where = {} } = {}) {
      const { sql, params } = buildWhere(where);
      const rows = await queryAll(`SELECT * FROM "StaffAccount"${sql ? ` WHERE ${sql}` : ""}`, params);
      return rows.map(mapStaffAccount);
    },
    async create({ data }) {
      const payload = withGeneratedId({ createdAt: new Date(), updatedAt: new Date(), ...data });
      const fields = Object.keys(payload);
      const values = Object.values(payload);
      const placeholders = fields.map((_, index) => `$${index + 1}`).join(", ");
      const row = await queryOne(
        `INSERT INTO "StaffAccount" (${fields.map((field) => `"${field}"`).join(", ")}) VALUES (${placeholders}) RETURNING *`,
        values,
      );
      return mapStaffAccount(row);
    },
    async update({ where, data }) {
      const fields = Object.keys(data);
      const values = Object.values(data);
      const sets = fields.map((field, index) => `"${field}" = $${index + 1}`).join(", ");
      const target = where.id ? `"id" = $${fields.length + 1}` : `"email" = $${fields.length + 1}`;
      const row = await queryOne(
        `UPDATE "StaffAccount" SET ${sets} WHERE ${target} RETURNING *`,
        [...values, where.id ?? where.email],
      );
      return mapStaffAccount(row);
    },
    async deleteMany({ where = {} }) {
      const { sql, params } = buildWhere(where);
      const result = await client.query(`DELETE FROM "StaffAccount"${sql ? ` WHERE ${sql}` : ""}`, params);
      return { count: result.rowCount ?? 0 };
    },
    async count({ where = {} } = {}) {
      const { sql, params } = buildWhere(where);
      const row = await queryOne(`SELECT COUNT(*)::int AS count FROM "StaffAccount"${sql ? ` WHERE ${sql}` : ""}`, params);
      return mapSimpleCountRow(row);
    },
  };

  const staffInvitation = {
    async findFirst({ where = {} }) {
      const { sql, params } = buildWhere(where);
      const row = await queryOne(`SELECT * FROM "StaffInvitation"${sql ? ` WHERE ${sql}` : ""} ORDER BY "createdAt" DESC LIMIT 1`, params);
      return mapInvitation(row);
    },
    async findUnique({ where }) {
      if (where.tokenHash) {
        return mapInvitation(await queryOne(`SELECT * FROM "StaffInvitation" WHERE "tokenHash" = $1 LIMIT 1`, [where.tokenHash]));
      }
      if (where.id) {
        return mapInvitation(await queryOne(`SELECT * FROM "StaffInvitation" WHERE "id" = $1 LIMIT 1`, [where.id]));
      }
      return null;
    },
    async create({ data }) {
      const payload = withGeneratedId({ createdAt: new Date(), updatedAt: new Date(), ...data });
      const fields = Object.keys(payload);
      const values = Object.values(payload);
      const placeholders = fields.map((_, index) => `$${index + 1}`).join(", ");
      const row = await queryOne(
        `INSERT INTO "StaffInvitation" (${fields.map((field) => `"${field}"`).join(", ")}) VALUES (${placeholders}) RETURNING *`,
        values,
      );
      return mapInvitation(row);
    },
    async update({ where, data }) {
      const fields = Object.keys(data);
      const values = Object.values(data);
      const sets = fields.map((field, index) => `"${field}" = $${index + 1}`).join(", ");
      const row = await queryOne(
        `UPDATE "StaffInvitation" SET ${sets} WHERE "id" = $${fields.length + 1} RETURNING *`,
        [...values, where.id],
      );
      return mapInvitation(row);
    },
    async updateMany({ where = {}, data }) {
      const dataFields = Object.keys(data);
      const dataValues = Object.values(data);
      const dataSets = dataFields.map((field, index) => `"${field}" = $${index + 1}`).join(", ");
      const { sql, params } = buildWhere(where, [...dataValues]);
      const result = await client.query(
        `UPDATE "StaffInvitation" SET ${dataSets}${sql ? ` WHERE ${sql}` : ""}`,
        params,
      );
      return { count: result.rowCount ?? 0 };
    },
    async deleteMany({ where = {} }) {
      const { sql, params } = buildWhere(where);
      const result = await client.query(`DELETE FROM "StaffInvitation"${sql ? ` WHERE ${sql}` : ""}`, params);
      return { count: result.rowCount ?? 0 };
    },
  };

  const staffPasswordReset = {
    async deleteMany({ where = {} }) {
      const { sql, params } = buildWhere(where);
      const result = await client.query(`DELETE FROM "StaffPasswordReset"${sql ? ` WHERE ${sql}` : ""}`, params);
      return { count: result.rowCount ?? 0 };
    },
    async create({ data }) {
      const payload = withGeneratedId({ createdAt: new Date(), updatedAt: new Date(), ...data });
      const fields = Object.keys(payload);
      const values = Object.values(payload);
      const placeholders = fields.map((_, index) => `$${index + 1}`).join(", ");
      const row = await queryOne(
        `INSERT INTO "StaffPasswordReset" (${fields.map((field) => `"${field}"`).join(", ")}) VALUES (${placeholders}) RETURNING *`,
        values,
      );
      return mapReset(row);
    },
  };

  const auditLog = {
    async create({ data }) {
      const payload = withGeneratedId({ createdAt: new Date(), ...data });
      const fields = Object.keys(payload);
      const values = Object.values(payload);
      const placeholders = fields.map((_, index) => `$${index + 1}`).join(", ");
      const row = await queryOne(
        `INSERT INTO "AuditLog" (${fields.map((field) => `"${field}"`).join(", ")}) VALUES (${placeholders}) RETURNING *`,
        values,
      );
      return mapAudit(row);
    },
    async findMany({ where = {} } = {}) {
      const { sql, params } = buildWhere(where);
      const rows = await queryAll(`SELECT * FROM "AuditLog"${sql ? ` WHERE ${sql}` : ""}`, params);
      return rows.map(mapAudit);
    },
    async deleteMany({ where = {} }) {
      const { sql, params } = buildWhere(where);
      const result = await client.query(`DELETE FROM "AuditLog"${sql ? ` WHERE ${sql}` : ""}`, params);
      return { count: result.rowCount ?? 0 };
    },
  };

  const permission = {
    async createMany({ data = [], skipDuplicates = false }) {
      let count = 0;
      for (const item of data) {
        const fields = Object.keys(item);
        const values = Object.values(item);
        const placeholders = fields.map((_, index) => `$${index + 1}`).join(", ");
        const conflict = skipDuplicates ? " ON CONFLICT (\"key\") DO NOTHING" : "";
        const result = await client.query(
          `INSERT INTO "Permission" (${fields.map((field) => `"${field}"`).join(", ")}) VALUES (${placeholders})${conflict}`,
          values,
        );
        count += result.rowCount ?? 0;
      }
      return { count };
    },
    async count() {
      const row = await queryOne(`SELECT COUNT(*)::int AS count FROM "Permission"`);
      return mapSimpleCountRow(row);
    },
  };

  const masterAdmin = {
    async count() {
      const row = await queryOne(`SELECT COUNT(*)::int AS count FROM "MasterAdmin"`);
      return mapSimpleCountRow(row);
    },
  };

  const masterAdminRefreshToken = {
    async count() {
      const row = await queryOne(`SELECT COUNT(*)::int AS count FROM "MasterAdminRefreshToken"`);
      return mapSimpleCountRow(row);
    },
  };

  const staffRole = {
    async count() {
      const row = await queryOne(`SELECT COUNT(*)::int AS count FROM "StaffRole"`);
      return mapSimpleCountRow(row);
    },
  };

  const staffPermission = {
    async count() {
      const row = await queryOne(`SELECT COUNT(*)::int AS count FROM "StaffPermission"`);
      return mapSimpleCountRow(row);
    },
  };

  const api = {
    staffAccount,
    staffInvitation,
    staffPasswordReset,
    auditLog,
    permission,
    staffRole,
    staffPermission,
    masterAdmin,
    masterAdminRefreshToken,
    findStaffByEmail: async (email) => staffAccount.findUnique({ where: { email } }),
    findStaffById: async (id) => staffAccount.findUnique({ where: { id } }),
    findPendingInvitationByStaffAccountId: async (staffAccountId) => staffInvitation.findFirst({ where: { staffAccountId, status: "pending" } }),
    findInvitationByTokenHash: async (tokenHash) => staffInvitation.findUnique({ where: { tokenHash } }),
    invalidatePendingInvitations: async (staffAccountId, now) => staffInvitation.updateMany({
      where: { staffAccountId, status: "pending" },
      data: { status: "revoked", revokedAt: now, updatedAt: now },
    }),
    createStaffAccount: async (data) => staffAccount.create({ data }),
    updateStaffAccount: async (id, data) => staffAccount.update({ where: { id }, data }),
    createInvitation: async (data) => staffInvitation.create({ data }),
    updateInvitation: async (id, data) => staffInvitation.update({ where: { id }, data }),
    revokeInvitation: async (id, now) => staffInvitation.update({ where: { id }, data: { status: "revoked", revokedAt: now, updatedAt: now } }),
    insertAuditLog: async (data) => auditLog.create({ data }),
    $transaction: async (work) => {
      const txClient = await pool.connect();
      try {
        await txClient.query("BEGIN");
        const txApi = createApi(txClient);
        const result = await work(txApi);
        await txClient.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await txClient.query("ROLLBACK");
        } catch {}
        throw error;
      } finally {
        txClient.release();
      }
    },
    $disconnect: async () => pool.end(),
  };

  return api;
}

const pool = new Pool({ connectionString: assertDatabaseUrl() });
const prisma = globalForPrisma.__adminStaffPrisma ?? createApi(pool);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.__adminStaffPrisma = prisma;
}

export { prisma };
