export declare const uuidv7Pk: () => import("node_modules/drizzle-orm").NotNull<import("node_modules/drizzle-orm").HasDefault<import("node_modules/drizzle-orm").IsPrimaryKey<import("node_modules/drizzle-orm").NotNull<import("node_modules/drizzle-orm/pg-core").PgTextBuilder<{
    name: "id";
    dataType: "string";
    columnType: "PgText";
    data: string;
    enumValues: [string, ...string[]];
    driverParam: string;
}>>>>>;
export declare const temporalColumns: {
    validFrom: import("node_modules/drizzle-orm").NotNull<import("node_modules/drizzle-orm").HasDefault<import("node_modules/drizzle-orm/pg-core").PgTimestampBuilderInitial<"valid_from">>>;
    validTo: import("node_modules/drizzle-orm/pg-core").PgTimestampBuilderInitial<"valid_to">;
    modifiedBy: import("node_modules/drizzle-orm/pg-core").PgTextBuilder<{
        name: "modified_by";
        dataType: "string";
        columnType: "PgText";
        data: string;
        enumValues: [string, ...string[]];
        driverParam: string;
    }>;
};
export declare const timestampColumns: {
    createdAt: import("node_modules/drizzle-orm").NotNull<import("node_modules/drizzle-orm").HasDefault<import("node_modules/drizzle-orm/pg-core").PgTimestampBuilderInitial<"created_at">>>;
    updatedAt: import("node_modules/drizzle-orm").NotNull<import("node_modules/drizzle-orm").HasDefault<import("node_modules/drizzle-orm/pg-core").PgTimestampBuilderInitial<"updated_at">>>;
};
