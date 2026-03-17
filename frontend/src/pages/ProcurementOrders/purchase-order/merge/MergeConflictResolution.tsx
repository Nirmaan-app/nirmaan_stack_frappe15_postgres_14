import { useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radiogroup";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import formatToIndianRupee from "@/utils/FormatPrice";
import { TAX_OPTIONS } from "./constants";
import type {
  RegularItemConflict,
  ChargeConflict,
  RegularItemResolution,
  ChargeResolution,
} from "./types";

interface MergeConflictResolutionProps {
  regularConflicts: RegularItemConflict[];
  chargeConflicts: ChargeConflict[];
  regularResolutions: Record<string, RegularItemResolution>;
  chargeResolutions: Record<string, ChargeResolution>;
  onRegularResolutionChange: (key: string, res: RegularItemResolution) => void;
  onChargeResolutionChange: (key: string, res: ChargeResolution) => void;
  estimatedTotal: number;
}

export function MergeConflictResolution({
  regularConflicts,
  chargeConflicts,
  regularResolutions,
  chargeResolutions,
  onRegularResolutionChange,
  onChargeResolutionChange,
  estimatedTotal,
}: MergeConflictResolutionProps) {
  return (
    <div className="space-y-6">
      {/* Estimated Total */}
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-medium text-muted-foreground">
          Estimated Total
        </span>
        <span className="text-lg font-semibold">
          {formatToIndianRupee(estimatedTotal)}
        </span>
      </div>

      {/* Section A: Regular Item Conflicts */}
      {regularConflicts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Item Rate Conflicts
          </h3>
          {regularConflicts.map((conflict) => (
            <RegularConflictCard
              key={conflict.key}
              conflict={conflict}
              resolution={regularResolutions[conflict.key]}
              onChange={(res) => onRegularResolutionChange(conflict.key, res)}
            />
          ))}
        </div>
      )}

      {/* Section B: Additional Charges */}
      {chargeConflicts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Additional Charges
          </h3>
          {chargeConflicts.map((conflict) => (
            <ChargeConflictCard
              key={conflict.key}
              conflict={conflict}
              resolution={chargeResolutions[conflict.key]}
              onChange={(res) => onChargeResolutionChange(conflict.key, res)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Regular Item Conflict Card ---

function RegularConflictCard({
  conflict,
  resolution,
  onChange,
}: {
  conflict: RegularItemConflict;
  resolution: RegularItemResolution;
  onChange: (res: RegularItemResolution) => void;
}) {
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");

  const currentQuote = resolution?.resolvedQuote ?? conflict.sources[0].quote;
  const currentTax = resolution?.resolvedTax ?? 18;

  const handleRadioChange = (value: string) => {
    if (value === "custom") {
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    const quote = parseFloat(value);
    onChange({ resolvedQuote: quote, resolvedTax: currentTax });
  };

  const handleCustomBlur = () => {
    let val = parseFloat(customValue);
    if (isNaN(val) || val <= 0) {
      val = conflict.sources[0].quote;
    }
    // Clamp to max quote
    if (val > conflict.maxQuote) {
      val = conflict.maxQuote;
    }
    setCustomValue(String(val));
    onChange({ resolvedQuote: val, resolvedTax: currentTax });
  };

  const handleTaxChange = (tax: string) => {
    onChange({ resolvedQuote: currentQuote, resolvedTax: parseInt(tax) });
  };

  // Determine radio value
  const radioValue = customMode
    ? "custom"
    : String(currentQuote);

  return (
    <Card className="border">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-sm truncate">
              {conflict.item_name}
            </span>
            {conflict.make && (
              <Badge variant="outline" className="text-xs shrink-0">
                {conflict.make}
              </Badge>
            )}
          </div>
          <Badge variant="secondary" className="shrink-0">
            Total Qty: {conflict.totalQuantity} {conflict.unit}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {/* Rate selection */}
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Pick Rate</Label>
          <RadioGroup
            value={radioValue}
            onValueChange={handleRadioChange}
            className="gap-2"
          >
            {conflict.sources.map((source) => (
              <div
                key={source.poName}
                className="flex items-center gap-2"
              >
                <RadioGroupItem
                  value={String(source.quote)}
                  id={`${conflict.key}-${source.poName}`}
                />
                <Label
                  htmlFor={`${conflict.key}-${source.poName}`}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Badge variant="outline" className="text-xs font-mono">
                    {source.poName.slice(3, 6)}
                  </Badge>
                  {formatToIndianRupee(source.quote)}
                  <span className="text-muted-foreground text-xs">
                    (Qty: {source.quantity})
                  </span>
                </Label>
              </div>
            ))}

            {/* Custom option */}
            <div className="flex items-center gap-2">
              <RadioGroupItem
                value="custom"
                id={`${conflict.key}-custom`}
              />
              <Label
                htmlFor={`${conflict.key}-custom`}
                className="text-sm cursor-pointer"
              >
                Custom
              </Label>
              {customMode && (
                <Input
                  type="number"
                  className="h-7 w-28 text-sm"
                  placeholder={`Max: ${conflict.maxQuote}`}
                  value={customValue}
                  onChange={(e) => setCustomValue(e.target.value)}
                  onBlur={handleCustomBlur}
                  max={conflict.maxQuote}
                  min={0}
                  step="any"
                  autoFocus
                />
              )}
            </div>
          </RadioGroup>
        </div>

        {/* Tax + Subtotal row */}
        <div className="flex items-center justify-between gap-4 pt-1 border-t">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Tax %</Label>
            <Select
              value={String(currentTax)}
              onValueChange={handleTaxChange}
            >
              <SelectTrigger className="h-7 w-20 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAX_OPTIONS.map((t) => (
                  <SelectItem key={t} value={String(t)}>
                    {t}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="text-sm font-medium">
            Subtotal:{" "}
            {formatToIndianRupee(
              conflict.totalQuantity * currentQuote * (1 + currentTax / 100)
            )}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// --- Charge Conflict Card ---

function ChargeConflictCard({
  conflict,
  resolution,
  onChange,
}: {
  conflict: ChargeConflict;
  resolution: ChargeResolution;
  onChange: (res: ChargeResolution) => void;
}) {
  const [customMode, setCustomMode] = useState(false);
  const [customValue, setCustomValue] = useState("");

  const currentAmount = resolution?.resolvedAmount ?? conflict.sources[0].quote;
  const currentTax = resolution?.resolvedTax ?? conflict.sources[0].tax;

  const handleRadioChange = (value: string) => {
    if (value === "custom") {
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    if (value === "sum") {
      onChange({ resolvedAmount: conflict.sumAmount, resolvedTax: currentTax });
    } else {
      onChange({ resolvedAmount: parseFloat(value), resolvedTax: currentTax });
    }
  };

  const handleCustomBlur = () => {
    let val = parseFloat(customValue);
    if (isNaN(val) || val <= 0) {
      val = conflict.sources[0].quote;
    }
    if (val > conflict.sumAmount) {
      val = conflict.sumAmount;
    }
    setCustomValue(String(val));
    onChange({ resolvedAmount: val, resolvedTax: currentTax });
  };

  const handleTaxChange = (tax: string) => {
    onChange({ resolvedAmount: currentAmount, resolvedTax: parseInt(tax) });
  };

  // Determine radio value
  let radioValue: string;
  if (customMode) {
    radioValue = "custom";
  } else if (currentAmount === conflict.sumAmount && conflict.sources.every(s => s.quote !== conflict.sumAmount)) {
    radioValue = "sum";
  } else {
    radioValue = String(currentAmount);
  }

  return (
    <Card className="border">
      <CardHeader className="py-3 px-4">
        <span className="font-medium text-sm">{conflict.item_name}</span>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <RadioGroup
          value={radioValue}
          onValueChange={handleRadioChange}
          className="gap-2"
        >
          {conflict.sources.map((source) => (
            <div
              key={source.poName}
              className="flex items-center gap-2"
            >
              <RadioGroupItem
                value={String(source.quote)}
                id={`${conflict.key}-${source.poName}`}
              />
              <Label
                htmlFor={`${conflict.key}-${source.poName}`}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <Badge variant="outline" className="text-xs font-mono">
                  {source.poName.slice(3, 6)}
                </Badge>
                {formatToIndianRupee(source.quote)}
              </Label>
            </div>
          ))}

          {/* Sum option */}
          <div className="flex items-center gap-2">
            <RadioGroupItem
              value="sum"
              id={`${conflict.key}-sum`}
            />
            <Label
              htmlFor={`${conflict.key}-sum`}
              className="text-sm cursor-pointer"
            >
              Sum of all: {formatToIndianRupee(conflict.sumAmount)}
            </Label>
          </div>

          {/* Custom option */}
          <div className="flex items-center gap-2">
            <RadioGroupItem
              value="custom"
              id={`${conflict.key}-custom`}
            />
            <Label
              htmlFor={`${conflict.key}-custom`}
              className="text-sm cursor-pointer"
            >
              Custom
            </Label>
            {customMode && (
              <Input
                type="number"
                className="h-7 w-28 text-sm"
                placeholder={`Max: ${conflict.sumAmount}`}
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                onBlur={handleCustomBlur}
                max={conflict.sumAmount}
                min={0}
                step="any"
                autoFocus
              />
            )}
          </div>
        </RadioGroup>

        {/* Tax + Subtotal row */}
        <div className="flex items-center justify-between gap-4 pt-1 border-t">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Tax %</Label>
            <Select
              value={String(currentTax)}
              onValueChange={handleTaxChange}
            >
              <SelectTrigger className="h-7 w-20 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TAX_OPTIONS.map((t) => (
                  <SelectItem key={t} value={String(t)}>
                    {t}%
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="text-sm font-medium">
            Subtotal: {formatToIndianRupee(currentAmount * (1 + currentTax / 100))}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
