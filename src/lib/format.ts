export const formatNumber = (value: number | null | undefined) => value == null ? "待更新" : value.toLocaleString("zh-CN");
