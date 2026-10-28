import { apiFetch } from "@/lib/api-client";
import type {
  RestaurantInput,
  RestaurantList,
  RestaurantSaved,
} from "@/types/supplier";

/**
 * Supplier › Restaurant 的午餐店（G199，后端 8a `app/routers/supplier.py`）。四个接口都是 require_admin；
 * 400 的 detail 能直接给 staff 看；每次真改了写 action_log（entity lunch_restaurant）。
 */
const API = "/api/supplier/restaurants";

export function fetchRestaurants(
  signal?: AbortSignal,
): Promise<RestaurantList> {
  return apiFetch<RestaurantList>(API, { cache: "no-store", signal });
}

export function createRestaurant(
  input: RestaurantInput,
): Promise<RestaurantSaved> {
  return apiFetch<RestaurantSaved>(API, { method: "POST", body: input });
}

export function updateRestaurant(
  id: number,
  input: RestaurantInput,
): Promise<RestaurantSaved> {
  return apiFetch<RestaurantSaved>(`${API}/${id}`, {
    method: "PUT",
    body: input,
  });
}

/** 还分配着团的店后端不让删（400 写明是哪几个团）。 */
export function deleteRestaurant(
  id: number,
): Promise<{ ok: true; id: number }> {
  return apiFetch(`${API}/${id}`, { method: "DELETE" });
}
