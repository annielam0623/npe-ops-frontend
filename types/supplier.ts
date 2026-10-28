/**
 * Supplier › Restaurant（G199，后端 8a `task/g199-supplier-restaurant` 11636fb 的形状，migrate_v124）。
 * 一家午餐店：店名、页脚两行（印在午餐表最底下的亮黄两行）、员工备注（不印）；一团一店，一店可给多个团。
 */
export interface LunchRestaurant {
  id: number;
  name: string;
  /** 最多两行，用 \n 分开。 */
  footer: string;
  staff_note: string;
  /** 没人改过是 ""。 */
  updated_by: string;
  updated_at: string | null;
  /** 分给这家的团。 */
  groups: { id: number; display_name: string }[];
}

/** 所有 bus_tour 团（选「给哪些团」用），带各自现在的店。 */
export interface RestaurantTourGroup {
  id: number;
  display_name: string;
  is_active: boolean;
  restaurant_id: number | null;
}

export interface RestaurantList {
  restaurants: LunchRestaurant[];
  groups: RestaurantTourGroup[];
}

export interface RestaurantInput {
  name: string;
  footer: string;
  staff_note: string;
  /** 整组替换；从别家送过来的团挪到这家。 */
  manifest_ids: number[];
}

export interface RestaurantSaved {
  ok: true;
  id: number;
  name: string;
  footer: string;
  staff_note: string;
  manifest_ids: number[];
  /** {团 id: 原来那家店 id}：这次从别家挪过来的团。 */
  moved_from?: Record<string, number>;
}
