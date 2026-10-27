// Type check only (no runtime code): the package services satisfy the structural types the
// Studio screens and handlers declare (PL5-D-14 item 2). `tsc` fails here if a service changes a
// method the screens call.
import type { BrandStudio } from "@infrabyx/brand";
import type {
  CmsStudio,
  MediaLibrary,
  PolicyStudio,
  PricingService,
  ResourceService,
} from "@infrabyx/cms";
import type { ConsentTexts } from "@infrabyx/consent";
import type { KernelContext } from "@infrabyx/contracts/kernel";
import type { Catalogue } from "@infrabyx/contracts/ports";
import type { FeedbackService } from "@infrabyx/feedback";
import type { TrustMirror } from "@infrabyx/trust";
import type * as S from "@infrabyx/ui/studio";

type C = KernelContext;
type Fits<T, U> = T extends U ? true : false;
const ok = <T extends true>(_: T) => _;

export const conformance = [
  ok<
    Fits<
      CmsStudio,
      S.ContentReader<C> &
        S.ContentWriter<C> &
        S.RedirectReader<C> &
        S.RedirectWriter<C> &
        S.ClaimReader<C> &
        S.ClaimWriter<C>
    >
  >(true),
  ok<Fits<BrandStudio, S.BrandQueueReader<C> & S.BrandWriter<C>>>(true),
  ok<Fits<MediaLibrary, S.MediaReader<C> & S.MediaWriter<C>>>(true),
  ok<Fits<PolicyStudio, S.PolicyReader<C> & S.PolicyWriter<C>>>(true),
  ok<
    Fits<
      ConsentTexts,
      S.ConsentTextReader<C> &
        S.ConsentTextWriter<C> & { drafts(ctx: C): Promise<S.StudioConsentText[]> }
    >
  >(true),
  ok<Fits<FeedbackService, S.FeedbackQueueReader<C>>>(true),
  ok<Fits<TrustMirror, S.TrustMirrorReader>>(true),
  ok<Fits<ResourceService, S.ResourceVersionsReader & S.ResourceVersionsWriter<C>>>(true),
  ok<Fits<PricingService["catalogue"], (packId: string) => Promise<Catalogue>>>(true),
] as const;
