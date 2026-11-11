"use client";

import dynamic from "next/dynamic";

// Maps uses browser APIs, so keep the form client-only behind a client boundary.
const ClientPostcardForm = dynamic(() => import("./PostcardForm"), {
  ssr: false,
});

export default ClientPostcardForm;
