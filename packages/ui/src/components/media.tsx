// Click-to-load third-party content (IPB-04-54, IPB-04-79; IPB-06 SC 1.4.2). The server renders a
// poster, the provider's name and a notice; the provider's iframe sits inside a `<template>`, which
// the browser never loads. The first-party controller (`@infrabyx/consent`) clones it only after a
// click AND consent for the category; without consent the click opens the preference centre.
// Privacy-enhanced hosts only (youtube-nocookie.com, Vimeo with dnt=1).
import { messages, type Messages } from "../i18n/messages.js";

const en = messages("en-IN");

const ALLOWED_EMBED_HOSTS = new Set(["www.youtube-nocookie.com", "player.vimeo.com"]);

export function embedUrl(provider: "youtube" | "vimeo", videoId: string): string {
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(videoId)) throw new Error("invalid video id");
  return provider === "youtube"
    ? `https://www.youtube-nocookie.com/embed/${videoId}`
    : `https://player.vimeo.com/video/${videoId}?dnt=1`;
}

export function ClickToLoad({
  id,
  provider,
  providerName,
  videoId,
  title,
  duration,
  posterSrc,
  posterAlt,
  category = "functional",
  t = en,
}: {
  id: string;
  provider: "youtube" | "vimeo";
  providerName: string;
  videoId: string;
  title: string;
  duration?: string;
  /** A first-party poster image (media library); never the provider's thumbnail URL. */
  posterSrc?: string;
  posterAlt?: string;
  category?: "functional" | "marketing";
  t?: Messages;
}) {
  const src = embedUrl(provider, videoId);
  if (!ALLOWED_EMBED_HOSTS.has(new URL(src).host)) throw new Error("embed host not allowed");
  return (
    <figure className="ibx-ctl" id={id} data-consent-category={category}>
      {posterSrc ? <img className="ibx-ctl__poster" src={posterSrc} alt={posterAlt ?? ""} /> : null}
      <figcaption className="ibx-ctl__caption">
        <span className="ibx-ctl__title">{title}</span>
        {duration ? <span> · {t.t("ui.media.duration", { duration })}</span> : null}
        <span className="ibx-ctl__notice">
          {t.t("ui.media.notice", { provider: providerName })}
        </span>
      </figcaption>
      <button type="button" className="ibx-button ibx-button--secondary" data-click-to-load={id}>
        {t.t("ui.media.load", { provider: providerName })}
      </button>
      <template data-embed-for={id}>
        <iframe
          className="ibx-ctl__frame"
          src={src}
          title={title}
          loading="lazy"
          allow="encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </template>
    </figure>
  );
}
