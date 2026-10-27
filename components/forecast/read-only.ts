import { createContext } from "react";

/**
 * 只读（员工权限：没有 forecast.edit，后端 17 2026-10-26）：表上的格子 / 导游 / 开不开团 / Max allotments
 * 都不给点（编辑框打不开），只能看。Action log 照常。
 */
export const ForecastReadOnly = createContext(false);
