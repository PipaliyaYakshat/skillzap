export const USER_ROLE = ['admin', 'userLogin'] as const;
export const USER_TYPE = ['individual', 'superAdmin','admin','member'] as const;

export type UserRole = (typeof USER_ROLE)[number];
export type UserType = (typeof USER_TYPE)[number];
