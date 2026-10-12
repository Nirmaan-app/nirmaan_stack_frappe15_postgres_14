import React, { useRef, useState } from 'react';
import { useFrappePostCall } from 'frappe-react-sdk';
import { TailSpin } from 'react-loader-spinner';
import { ArrowLeft, Download, Eraser, PenLine, Undo2 } from 'lucide-react';

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { downloadPrintFormatPdf } from '@/utils/downloadPrintFormatPdf';
import { formatDate } from '@/utils/FormatDate';
import { getFrappeError } from '@/utils/frappeErrors';

import { ASSET_MASTER_DOCTYPE } from '../assets.constants';
import { SignaturePad, SignaturePadHandle, prefersTouchInput } from './SignaturePad';

const SIGN_DECLARATION_METHOD = 'nirmaan_stack.api.assets.declaration.sign_declaration';
const DECLARATION_FORMAT = 'Asset Master Form';

// The four terms of the Asset Allocation Form that matter most, in plain words.
const KEY_TERMS = [
    'Keep it safe and use it for work.',
    'Damage beyond normal wear, loss or theft can be recovered from your salary.',
    'Report any problem to IT and HR within 24 hours.',
    'Return it in good condition when you leave or when asked.',
];

type Step = 'confirm' | 'sign';

// On phones and tablets (in either orientation) the window fills the screen: buttons stay at
// the bottom, the middle scrolls, and the signature box gets the room. Laptops keep the centred
// window. Keyed on a touch pointer, not width, because a phone held sideways is wider than `sm`.
const TOUCH_FULL_SCREEN = [
    '[@media(pointer:coarse)]:inset-0',
    '[@media(pointer:coarse)]:left-0',
    '[@media(pointer:coarse)]:top-0',
    '[@media(pointer:coarse)]:translate-x-0',
    '[@media(pointer:coarse)]:translate-y-0',
    '[@media(pointer:coarse)]:h-[100dvh]',
    '[@media(pointer:coarse)]:max-h-[100dvh]',
    '[@media(pointer:coarse)]:max-w-none',
    '[@media(pointer:coarse)]:rounded-none',
    '[@media(pointer:coarse)]:border-0',
    '[@media(pointer:coarse)]:gap-3',
    '[@media(pointer:coarse)]:p-4',
    '[@media(pointer:coarse)]:data-[state=open]:slide-in-from-left-0',
    '[@media(pointer:coarse)]:data-[state=open]:slide-in-from-top-0',
    '[@media(pointer:coarse)]:data-[state=closed]:slide-out-to-left-0',
    '[@media(pointer:coarse)]:data-[state=closed]:slide-out-to-top-0',
].join(' ');

// A phone held sideways is short: drop the long instruction line (the hint under the box says
// the same) so the signature box keeps its height.
const HIDE_WHEN_SHORT = '[@media(max-height:520px)]:hidden';

interface SignDeclarationDialogProps {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    /** The Asset Management record being signed. */
    assignmentId: string;
    assetId: string;
    assetName: string;
    serialNumber?: string | null;
    condition?: string | null;
    assignedOn?: string | null;
    onSigned?: () => void;
}

/**
 * Two steps: the employee first sees what the asset and the declaration are and agrees to the
 * terms, then writes their signature. The server places it on the "Asset Master Form" and
 * attaches the signed PDF to the assignment. Only the assignee can sign; the server checks.
 */
export const SignDeclarationDialog: React.FC<SignDeclarationDialogProps> = ({
    isOpen,
    onOpenChange,
    assignmentId,
    assetId,
    assetName,
    serialNumber,
    condition,
    assignedOn,
    onSigned,
}) => {
    const { toast } = useToast();
    const padRef = useRef<SignaturePadHandle>(null);
    const [step, setStep] = useState<Step>('confirm');
    const [agreed, setAgreed] = useState(false);
    const [strokeCount, setStrokeCount] = useState(0);
    const [isDownloading, setIsDownloading] = useState(false);
    const [onTouchDevice] = useState(prefersTouchInput);
    const { call: signDeclaration, loading: isSigning } = useFrappePostCall<{ message: { file_url: string } }>(
        SIGN_DECLARATION_METHOD
    );

    const close = () => {
        setStep('confirm');
        setAgreed(false);
        setStrokeCount(0);
        onOpenChange(false);
    };

    const handleOpenChange = (open: boolean) => {
        if (isSigning) return; // keep the dialog while the PDF is being made
        if (open) onOpenChange(true);
        else close();
    };

    const handleReadForm = async () => {
        setIsDownloading(true);
        try {
            await downloadPrintFormatPdf({
                doctype: ASSET_MASTER_DOCTYPE,
                name: assetId,
                format: DECLARATION_FORMAT,
                fileName: `${assetName || assetId}_Declaration_Form.pdf`,
            });
        } catch (error) {
            toast({
                title: 'Could not open the form',
                description: error instanceof Error ? error.message : 'Try again in a moment.',
                variant: 'destructive',
            });
        } finally {
            setIsDownloading(false);
        }
    };

    const handleSign = async () => {
        const pad = padRef.current;
        if (!pad || pad.isEmpty()) return;
        try {
            await signDeclaration({ assignment: assignmentId, signature: pad.toDataURL() });
            toast({
                title: 'Declaration signed',
                description: `The signed declaration is attached to ${assetName || assetId}.`,
                variant: 'success',
            });
            close();
            onSigned?.();
        } catch (error) {
            toast({
                title: 'Could not sign the declaration',
                description: getFrappeError(error),
                variant: 'destructive',
            });
        }
    };

    const details: [string, string][] = [
        ['Asset', assetName ? `${assetName} · ${assetId}` : assetId],
        ['Serial no.', serialNumber || '—'],
        ['Condition', condition || '—'],
        ['Given on', assignedOn ? formatDate(assignedOn) : '—'],
    ];

    return (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent className={`flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl ${TOUCH_FULL_SCREEN}`}>
                <DialogHeader className="shrink-0 pr-6 text-left">
                    <p className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                        Step {step === 'confirm' ? '1' : '2'} of 2
                    </p>
                    <DialogTitle>
                        {step === 'confirm' ? 'Confirm you received this asset' : 'Add your signature'}
                    </DialogTitle>
                    <DialogDescription className={step === 'sign' ? HIDE_WHEN_SHORT : undefined}>
                        {step === 'confirm'
                            ? 'Your asset declaration, signed in the app instead of on paper.'
                            : onTouchDevice
                              ? 'Write your signature in the box with your finger. Lift your finger between words. Turn the phone sideways for more room.'
                              : 'Point at the box, hold the Space bar and move the mouse or touchpad to write. Let go of Space to move to the next word without drawing.'}
                    </DialogDescription>
                </DialogHeader>

                {step === 'confirm' ? (
                    <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
                        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 rounded-lg border bg-gray-50 p-3 text-sm">
                            {details.map(([label, value]) => (
                                <React.Fragment key={label}>
                                    <dt className="text-gray-500">{label}</dt>
                                    <dd className="min-w-0 break-words font-medium text-gray-900">{value}</dd>
                                </React.Fragment>
                            ))}
                        </dl>

                        <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
                            <p className="font-semibold">Why am I signing?</p>
                            <p className="mt-0.5">
                                This replaces the paper Asset Allocation Form. Your signature confirms you received
                                this asset and will look after it.
                            </p>
                        </div>

                        <div className="text-sm">
                            <p className="font-semibold text-gray-900">What you're agreeing to</p>
                            <ul className="mt-1 list-disc space-y-1 pl-5 text-gray-700">
                                {KEY_TERMS.map((term) => (
                                    <li key={term}>{term}</li>
                                ))}
                            </ul>
                            <Button
                                type="button"
                                variant="link"
                                size="sm"
                                className="mt-1 h-auto gap-1.5 px-0 text-emerald-700"
                                onClick={handleReadForm}
                                disabled={isDownloading}
                            >
                                {isDownloading ? (
                                    <TailSpin height={14} width={14} color="#047857" />
                                ) : (
                                    <Download className="h-3.5 w-3.5" />
                                )}
                                {isDownloading ? 'Preparing the form…' : 'Read the full form (PDF)'}
                            </Button>
                        </div>

                        <label htmlFor="declaration-agree" className="flex cursor-pointer items-start gap-2.5 text-sm">
                            <Checkbox
                                id="declaration-agree"
                                checked={agreed}
                                onCheckedChange={(value) => setAgreed(value === true)}
                                className="mt-0.5"
                            />
                            <span>I have received this asset and agree to the terms.</span>
                        </label>
                    </div>
                ) : (
                    <div className="flex min-h-0 flex-1 flex-col">
                        {/* Laptop: a fixed tall box. Touch screens: the box takes the free height. */}
                        <SignaturePad
                            ref={padRef}
                            onStrokesChange={setStrokeCount}
                            disabled={isSigning}
                            className="h-56 shrink-0 sm:h-72 [@media(pointer:coarse)]:h-auto [@media(pointer:coarse)]:max-h-[22rem] [@media(pointer:coarse)]:min-h-[9rem] [@media(pointer:coarse)]:flex-1"
                        />
                    </div>
                )}

                {step === 'confirm' ? (
                    <DialogFooter className="shrink-0 gap-2 sm:gap-0">
                        <Button type="button" variant="outline" onClick={close}>
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            onClick={() => setStep('sign')}
                            disabled={!agreed}
                            className="bg-emerald-600 hover:bg-emerald-700"
                        >
                            Next
                        </Button>
                    </DialogFooter>
                ) : (
                    <DialogFooter className="shrink-0 flex-row items-center justify-between gap-2 sm:justify-between sm:space-x-0">
                        <div className="flex items-center gap-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="gap-1.5 px-2 text-gray-600"
                                onClick={() => padRef.current?.undo()}
                                disabled={strokeCount === 0 || isSigning}
                                aria-label="Undo the last stroke"
                            >
                                <Undo2 className="h-4 w-4" />
                                <span className="max-sm:sr-only">Undo</span>
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="gap-1.5 px-2 text-gray-600"
                                onClick={() => padRef.current?.clear()}
                                disabled={strokeCount === 0 || isSigning}
                                aria-label="Clear the signature"
                            >
                                <Eraser className="h-4 w-4" />
                                <span className="max-sm:sr-only">Clear</span>
                            </Button>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                className="gap-1.5 max-sm:px-3"
                                onClick={() => setStep('confirm')}
                                disabled={isSigning}
                            >
                                <ArrowLeft className="h-4 w-4" />
                                Back
                            </Button>
                            <Button
                                type="button"
                                onClick={handleSign}
                                disabled={strokeCount === 0 || isSigning}
                                className="gap-2 bg-emerald-600 hover:bg-emerald-700"
                            >
                                {isSigning ? (
                                    <TailSpin height={16} width={16} color="#ffffff" />
                                ) : (
                                    <PenLine className="h-4 w-4" />
                                )}
                                {isSigning ? 'Signing…' : 'Sign & Submit'}
                            </Button>
                        </div>
                    </DialogFooter>
                )}
            </DialogContent>
        </Dialog>
    );
};
