"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  CURRENCY_OPTIONS,
  currencyOptionLabel,
} from "@/lib/currencies"

export function CurrencySelect({
  id,
  onValueChange,
  value,
}: {
  id?: string
  onValueChange: (value: string) => void
  value: string
}) {
  const selectedCurrency = CURRENCY_OPTIONS.find(
    (option) => option.code === value,
  )

  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue) onValueChange(nextValue)
      }}
    >
      <SelectTrigger id={id} className="w-full">
        <SelectValue>
          {selectedCurrency
            ? currencyOptionLabel(selectedCurrency)
            : "Unavailable currency"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {!selectedCurrency ? (
          <SelectItem value={value}>Unavailable currency</SelectItem>
        ) : null}
        {CURRENCY_OPTIONS.map((option) => (
          <SelectItem key={option.code} value={option.code}>
            {currencyOptionLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
